// Node-side HA WebSocket transport (#617). The mirror of @glaon/core's
// DirectWsTransport, but for the apps/api Node runtime.
//
// Why a separate transport: DirectWsTransport is written against the
// DOM/RN `WebSocket` types (generic `MessageEvent<T>`, `CloseEvent`),
// which don't exist under apps/api's Node-only tsconfig — and per the
// package-boundary rule (CLAUDE.md), platform-specific transports live
// in `apps/*`, not in @glaon/core. This uses Node 22's native global
// `WebSocket` (undici), typed via a minimal local interface because
// @types/node 22 doesn't declare the global yet.
//
// HaClient drives the auth handshake + id correlation over this wire;
// the transport just pumps opaque frames (ADR 0016).

import type {
  CloseInfo,
  HaInboundFrame,
  HaOutboundFrame,
  HaTransport,
  TransportEvent,
  TransportEventHandler,
  TransportSubscription,
} from '@glaon/core/ha';

/** The slice of the WHATWG WebSocket Node 22 exposes globally that we use. */
interface NodeWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void, opts?: { once?: boolean }): void;
  addEventListener(
    type: 'message',
    listener: (ev: { readonly data: unknown }) => void,
    opts?: { once?: boolean },
  ): void;
  addEventListener(
    type: 'close',
    listener: (ev: { readonly code: number; readonly reason: string }) => void,
    opts?: { once?: boolean },
  ): void;
  removeEventListener(type: string, listener: (...args: never[]) => void): void;
}

type NodeWebSocketCtor = new (url: string) => NodeWebSocket;

interface Listeners {
  message: Set<(frame: HaInboundFrame) => void>;
  close: Set<(info: CloseInfo) => void>;
  error: Set<(err: Error) => void>;
}

export interface NodeWsTransportOptions {
  /** HA base URL (e.g. `http://homeassistant.local:8123`). Scheme rewritten to ws/wss. */
  readonly baseUrl: string;
  /** Constructor injection for tests; defaults to Node's global WebSocket. */
  readonly webSocketImpl?: NodeWebSocketCtor;
}

export class NodeWsTransport implements HaTransport {
  private socket: NodeWebSocket | null = null;
  private clientInitiatedClose = false;
  private readonly listeners: Listeners = {
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };

  constructor(private readonly options: NodeWsTransportOptions) {}

  connect(): Promise<void> {
    if (this.socket !== null) {
      throw new Error('NodeWsTransport.connect: already connected');
    }
    const Ctor = this.options.webSocketImpl ?? resolveGlobalWebSocket();
    const socket = new Ctor(buildWsUrl(this.options.baseUrl));
    this.socket = socket;
    this.clientInitiatedClose = false;

    socket.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let parsed: HaInboundFrame;
      try {
        parsed = JSON.parse(data) as HaInboundFrame;
      } catch (cause) {
        const err = cause instanceof Error ? cause : new Error('NodeWsTransport: malformed frame');
        for (const listener of this.listeners.error) listener(err);
        return;
      }
      for (const listener of this.listeners.message) listener(parsed);
    });

    socket.addEventListener('close', (ev) => {
      const info: CloseInfo = {
        code: ev.code,
        reason: ev.reason,
        clientInitiated: this.clientInitiatedClose,
      };
      this.socket = null;
      for (const listener of this.listeners.close) listener(info);
    });

    socket.addEventListener('error', () => {
      const err = new Error('NodeWsTransport: socket error');
      for (const listener of this.listeners.error) listener(err);
    });

    return new Promise<void>((resolve, reject) => {
      socket.addEventListener(
        'open',
        () => {
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          reject(new Error('NodeWsTransport: failed to open socket'));
        },
        { once: true },
      );
    });
  }

  send(frame: HaOutboundFrame): void {
    if (this.socket === null) {
      throw new Error('NodeWsTransport.send: not connected');
    }
    this.socket.send(JSON.stringify(frame));
  }

  on<TEvent extends TransportEvent>(
    event: TEvent,
    handler: TransportEventHandler<TEvent>,
  ): TransportSubscription {
    const bucket = this.listeners[event] as Set<TransportEventHandler<TEvent>>;
    bucket.add(handler);
    return () => {
      bucket.delete(handler);
    };
  }

  close(): Promise<void> {
    const socket = this.socket;
    if (socket === null) return Promise.resolve();
    this.clientInitiatedClose = true;
    return new Promise<void>((resolve) => {
      socket.addEventListener(
        'close',
        () => {
          resolve();
        },
        { once: true },
      );
      socket.close(1000, 'client closed');
    });
  }
}

function resolveGlobalWebSocket(): NodeWebSocketCtor {
  const candidate = (globalThis as { WebSocket?: NodeWebSocketCtor }).WebSocket;
  if (candidate === undefined) {
    throw new Error('NodeWsTransport: global WebSocket unavailable (needs Node >= 22)');
  }
  return candidate;
}

function buildWsUrl(baseUrl: string): string {
  const url = new URL('/api/websocket', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
