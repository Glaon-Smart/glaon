// HaClient — see ADR 0016. Multiplexes a single HA WebSocket transport into typed
// request/response promises and subscription handles. Drives the HA auth handshake,
// owns reconnect orchestration with exponential backoff + jitter, and replays
// subscriptions + a `get_states` snapshot after each reconnect.
//
// Transport-agnostic: the same client works against DirectWsTransport (local mode)
// and CloudRelayTransport (cloud mode, lands once #345 is up). HA-side `id` correlation
// lives entirely here; the transport carries opaque frames.

import type {
  HaEventFrame,
  HaInboundFrame,
  HaOutboundFrame,
  HaResultFrame,
  HaStateChangedEvent,
} from './protocol/messages';
import type { CloseInfo, HaTransport, TransportSubscription } from './transport';
import type { HaEntityState } from '../types';

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'reconnecting';

/** `Omit` that distributes over a union, preserving each member's discriminant. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/**
 * Accepted shape for `HaClient.request`: every numbered outbound frame with
 * its auto-stamped `id` removed, as a union (not collapsed to common keys).
 */
type OutboundRequestFrame = DistributiveOmit<Extract<HaOutboundFrame, { id: number }>, 'id'>;

export interface HaClientOptions {
  /** Returns the current HA access token. Called on each (re)auth. */
  readonly getAccessToken: () => Promise<string>;
  /**
   * Called after `auth_invalid`. Implementations refresh the HA token via the
   * RefreshMutex from #9 and resolve with the new value (or throw to abort the
   * connection). Defaults to a single retry of `getAccessToken()`.
   */
  readonly refreshAccessToken?: () => Promise<string>;
  /**
   * Called after a successful reconnect with the freshly fetched entity snapshot —
   * the entity-store integration point per ADR 0015 / #11. Defaults to a no-op so
   * the client is testable in isolation.
   */
  readonly onSnapshot?: (states: readonly HaEntityState[]) => void;
  /** Connection-state observers receive every transition. */
  readonly onConnectionState?: (state: ConnectionState) => void;
  /** Heartbeat interval in ms. Defaults to 30 000. */
  readonly heartbeatIntervalMs?: number;
  /** Reconnect backoff base delay in ms. Defaults to 500 (per ADR 0016). */
  readonly reconnectBaseDelayMs?: number;
  /** Reconnect backoff cap in ms. Defaults to 30 000 (per ADR 0016). */
  readonly reconnectMaxDelayMs?: number;
  /**
   * Schedule injection — defaults to `setTimeout`. Tests pass a fake scheduler so
   * reconnect backoff is deterministic.
   */
  readonly schedule?: (fn: () => void, delayMs: number) => () => void;
  /**
   * Random jitter source — defaults to `Math.random`. Tests pin this for
   * deterministic backoff math.
   */
  readonly random?: () => number;
}

export interface SubscriptionHandle {
  /** Glaon-side stable id; the underlying HA `id` is remapped after each reconnect. */
  readonly id: number;
  unsubscribe(): Promise<void>;
}

export class HaConnectionLostError extends Error {
  constructor() {
    super('HA connection lost');
    this.name = 'HaConnectionLostError';
  }
}

export class HaServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HaServiceError';
  }
}

interface PendingRequest {
  resolve(data: unknown): void;
  reject(err: Error): void;
}

interface SubscriptionEntry {
  /** Frame factory replayed on reconnect (subscribe_events, subscribe_entities, ...). */
  buildFrame(id: number): HaOutboundFrame;
  callback(event: unknown): void;
  /** Last assigned HA-side id; remapped after each reconnect. */
  haId: number;
}

interface HaAuthOkLike {
  readonly type: 'auth_ok';
  readonly ha_version: string;
}

interface HaAuthInvalidLike {
  readonly type: 'auth_invalid';
  readonly message: string;
}

type HaAuthOkOrInvalid = HaAuthOkLike | HaAuthInvalidLike;

export class HaClient {
  private transport: HaTransport | null = null;
  private connectionState: ConnectionState = 'closed';
  private nextId = 1;
  private nextSubscriptionId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscriptions = new Map<number, SubscriptionEntry>();
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelReconnect: (() => void) | null = null;
  private reconnectAttempt = 0;
  private clientClosed = false;
  private transportSubs: TransportSubscription[] = [];

  constructor(
    private readonly transportFactory: () => HaTransport,
    private readonly options: HaClientOptions,
  ) {}

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    this.clientClosed = false;
    this.setState('connecting');
    const transport = this.transportFactory();
    this.transport = transport;
    this.attachTransport(transport);
    try {
      await transport.connect();
    } catch (cause) {
      this.detachTransport();
      this.transport = null;
      this.setState('closed');
      throw cause;
    }
    try {
      await this.runAuthHandshake();
    } catch (cause) {
      await transport.close();
      this.transport = null;
      this.setState('closed');
      throw cause;
    }
    this.setState('open');
    this.startHeartbeat();
    if (this.reconnectAttempt > 0) {
      // Reconnect path — replay subscriptions + reconcile snapshot.
      await this.replaySubscriptions();
      await this.reconcileSnapshot();
    }
    this.reconnectAttempt = 0;
  }

  async close(): Promise<void> {
    this.clientClosed = true;
    if (this.cancelReconnect !== null) {
      this.cancelReconnect();
      this.cancelReconnect = null;
    }
    this.stopHeartbeat();
    this.failAllPending(new HaConnectionLostError());
    if (this.transport !== null) {
      const t = this.transport;
      this.detachTransport();
      this.transport = null;
      await t.close();
    }
    this.setState('closed');
  }

  /**
   * Send a typed request and resolve with the HA `result` payload. Rejects with
   * `HaConnectionLostError` if the WS drops mid-flight or `HaServiceError` if HA
   * surfaces an error response.
   *
   * The frame param uses a *distributive* Omit (`OutboundRequestFrame`) so the
   * parameter stays a union of each frame-minus-id rather than collapsing to the
   * union members' common keys. Without that, a frame with a required
   * non-common property (e.g. `config/area_registry/create`'s `name`) would be
   * rejected by excess-property checking on an inline object literal.
   */
  request<TResult = unknown>(frame: OutboundRequestFrame): Promise<TResult> {
    if (this.transport === null || this.connectionState !== 'open') {
      return Promise.reject(new HaConnectionLostError());
    }
    const transport = this.transport;
    const id = this.nextId++;
    const fullFrame = { ...frame, id } as HaOutboundFrame;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (data) => {
          resolve(data as TResult);
        },
        reject,
      });
      try {
        transport.send(fullFrame);
      } catch (cause) {
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error('HaClient.send failed'));
      }
    });
  }

  /**
   * Subscribe to an HA event stream. Returns a handle whose `unsubscribe()` tells
   * HA to stop sending events and clears the local registry. Subscriptions
   * automatically re-register after reconnect.
   */
  async subscribe(
    buildFrame: (id: number) => HaOutboundFrame,
    callback: (event: unknown) => void,
  ): Promise<SubscriptionHandle> {
    const handleId = this.nextSubscriptionId++;
    const id = this.nextId++;
    const entry: SubscriptionEntry = {
      buildFrame,
      callback,
      haId: id,
    };
    this.subscriptions.set(handleId, entry);
    try {
      await this.sendSubscribeFrame(entry, id);
    } catch (cause) {
      this.subscriptions.delete(handleId);
      throw cause;
    }
    return {
      id: handleId,
      unsubscribe: async () => {
        const current = this.subscriptions.get(handleId);
        if (current === undefined) return;
        this.subscriptions.delete(handleId);
        if (this.transport !== null && this.connectionState === 'open') {
          try {
            await this.sendUnsubscribe(current.haId);
          } catch {
            // Best-effort: connection may have dropped while unsubscribing.
          }
        }
      },
    };
  }

  private sendUnsubscribe(subscriptionHaId: number): Promise<void> {
    if (this.transport === null) return Promise.reject(new HaConnectionLostError());
    const transport = this.transport;
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => {
          resolve();
        },
        reject,
      });
      try {
        transport.send({ id, type: 'unsubscribe_events', subscription: subscriptionHaId });
      } catch (cause) {
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error('HaClient.send failed'));
      }
    });
  }

  /** Convenience helper for the most common subscription. */
  subscribeStateChanges(
    callback: (event: HaStateChangedEvent) => void,
  ): Promise<SubscriptionHandle> {
    return this.subscribe(
      (id) => ({ id, type: 'subscribe_events', event_type: 'state_changed' }),
      (event) => {
        callback(event as HaStateChangedEvent);
      },
    );
  }

  getStates(): Promise<readonly HaEntityState[]> {
    return this.request<readonly HaEntityState[]>({ type: 'get_states' });
  }

  /* ------------------------------------------------------------------ internal */

  private attachTransport(transport: HaTransport): void {
    this.transportSubs = [
      transport.on('message', (frame) => {
        this.handleFrame(frame);
      }),
      transport.on('close', (info) => {
        this.handleClose(info);
      }),
      transport.on('error', () => {
        // Errors are non-fatal at the transport layer — close events are the
        // authoritative signal. We swallow here to avoid double-handling.
      }),
    ];
  }

  private detachTransport(): void {
    for (const unsub of this.transportSubs) unsub();
    this.transportSubs = [];
  }

  private setState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.options.onConnectionState?.(state);
  }

  private async runAuthHandshake(): Promise<void> {
    if (this.transport === null) throw new Error('HaClient: transport unset during auth');
    const transport = this.transport;
    const handshakeFrame = await this.awaitFrame(transport);
    if (handshakeFrame.type !== 'auth_required') {
      throw new Error(`HaClient: unexpected handshake frame ${handshakeFrame.type}`);
    }
    let token = await this.options.getAccessToken();
    transport.send({ type: 'auth', access_token: token });
    let result = await this.awaitAuthResolution(transport);
    if (result.type === 'auth_invalid') {
      const refresh = this.options.refreshAccessToken ?? (() => this.options.getAccessToken());
      token = await refresh();
      transport.send({ type: 'auth', access_token: token });
      result = await this.awaitAuthResolution(transport);
    }
    if (result.type !== 'auth_ok') {
      throw new Error(`HaClient: HA rejected auth (${result.message})`);
    }
  }

  private awaitFrame(transport: HaTransport): Promise<HaInboundFrame> {
    return new Promise<HaInboundFrame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub();
        reject(new Error('HaClient: handshake frame timed out'));
      }, 30_000);
      const unsub = transport.on('message', (frame) => {
        clearTimeout(timeout);
        unsub();
        resolve(frame);
      });
    });
  }

  private awaitAuthResolution(transport: HaTransport): Promise<HaAuthOkOrInvalid> {
    return new Promise<HaAuthOkOrInvalid>((resolve, reject) => {
      const unsub = transport.on('message', (frame) => {
        if (frame.type === 'auth_ok' || frame.type === 'auth_invalid') {
          unsub();
          resolve(frame);
        } else if (frame.type !== 'auth_required') {
          unsub();
          reject(new Error(`HaClient: unexpected frame during auth (${frame.type})`));
        }
      });
    });
  }

  private handleFrame(frame: HaInboundFrame): void {
    if (frame.type === 'result') {
      this.resolveResult(frame);
      return;
    }
    if (frame.type === 'event') {
      this.routeEvent(frame);
      return;
    }
    // pongs / auth frames during steady state are ignored — auth handshake
    // consumes its own frames during runAuthHandshake.
  }

  private resolveResult(frame: HaResultFrame): void {
    const pending = this.pending.get(frame.id);
    if (pending === undefined) return;
    this.pending.delete(frame.id);
    if (frame.success) {
      pending.resolve(frame.result);
    } else {
      const err = frame.error;
      pending.reject(
        new HaServiceError(err?.code ?? 'unknown', err?.message ?? 'HA returned an error'),
      );
    }
  }

  private routeEvent(frame: HaEventFrame): void {
    for (const entry of this.subscriptions.values()) {
      if (entry.haId === frame.id) {
        entry.callback(frame.event);
      }
    }
  }

  private handleClose(info: CloseInfo): void {
    this.detachTransport();
    this.transport = null;
    this.stopHeartbeat();
    this.failAllPending(new HaConnectionLostError());
    if (this.clientClosed || info.clientInitiated) {
      this.setState('closed');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.reconnectAttempt += 1;
    const baseDelay = this.options.reconnectBaseDelayMs ?? 500;
    const maxDelay = this.options.reconnectMaxDelayMs ?? 30_000;
    const exponential = Math.min(baseDelay * 2 ** (this.reconnectAttempt - 1), maxDelay);
    const random = this.options.random ?? Math.random;
    const jitter = exponential * 0.25 * (random() * 2 - 1);
    const delay = Math.max(0, exponential + jitter);
    const schedule =
      this.options.schedule ??
      ((fn: () => void, delayMs: number): (() => void) => {
        const handle = setTimeout(fn, delayMs);
        return () => {
          clearTimeout(handle);
        };
      });
    this.cancelReconnect = schedule(() => {
      this.cancelReconnect = null;
      void this.connect().catch(() => {
        if (!this.clientClosed) this.scheduleReconnect();
      });
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 30_000;
    if (interval <= 0) return;
    const tick = (): void => {
      if (this.transport === null || this.connectionState !== 'open') return;
      const id = this.nextId++;
      try {
        this.transport.send({ id, type: 'ping' });
      } catch {
        // Send error surfaces via the transport's error / close events.
      }
      this.heartbeatTimer = setTimeout(tick, interval);
    };
    this.heartbeatTimer = setTimeout(tick, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private failAllPending(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }

  private sendSubscribeFrame(entry: SubscriptionEntry, id: number): Promise<void> {
    if (this.transport === null) return Promise.reject(new HaConnectionLostError());
    const transport = this.transport;
    entry.haId = id;
    const frame = entry.buildFrame(id);
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => {
          resolve();
        },
        reject,
      });
      try {
        transport.send(frame);
      } catch (cause) {
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error('HaClient.send failed'));
      }
    });
  }

  private async replaySubscriptions(): Promise<void> {
    for (const entry of this.subscriptions.values()) {
      const id = this.nextId++;
      try {
        await this.sendSubscribeFrame(entry, id);
      } catch {
        // Replay failure typically means the connection dropped again — the
        // subsequent close event will trigger another reconnect.
      }
    }
  }

  private async reconcileSnapshot(): Promise<void> {
    if (this.options.onSnapshot === undefined) return;
    try {
      const states = await this.getStates();
      this.options.onSnapshot(states);
    } catch {
      // Snapshot fetch failure is non-fatal; UI keeps the last delta-applied state.
    }
  }
}
