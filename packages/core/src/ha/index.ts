export * from './client';
export * from './transport';
export * from './services';
export * from './setup-commands';
// NOTE: DirectWsTransport is intentionally NOT re-exported here. It is
// written against DOM `WebSocket` / `MessageEvent` / `CloseEvent` types,
// which a Node consumer (apps/api, #617) doesn't have in its tsconfig
// `lib`. Keeping it out of the barrel lets Node code import the
// transport-agnostic `HaClient` + protocol types from `@glaon/core/ha`
// without inheriting a DOM dependency. Browser / RN consumers import it
// from the dedicated subpath: `@glaon/core/ha/direct-ws`.
export type {
  HaInboundFrame,
  HaOutboundFrame,
  HaResultFrame,
  HaEventFrame,
  HaStateChangedEvent,
  HaAreaRegistryEntry,
  HaFloorRegistryEntry,
} from './protocol/messages';
