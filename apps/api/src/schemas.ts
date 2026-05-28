// Re-export the canonical Zod schemas from @glaon/core/api-client so
// `apps/api` route handlers validate incoming bodies with the very
// definitions the web + mobile clients build their requests against.
// Adding a schema goes via `packages/core/src/api-client/schemas.ts`;
// never define new shapes in this file. Response schemas live at
// `@glaon/core/api-client` directly — server handlers don't re-parse
// outgoing bodies (the response is what `c.json` ships) so only the
// request validators are surfaced here.

export {
  ApplyHaRequestSchema,
  AuthExchangeRequestSchema,
  AuthRefreshRequestSchema,
  HaPasswordGrantRequestSchema,
} from '@glaon/core/api-client';
