// Public surface of @glaon/core/api-client. Both apps/web and apps/mobile
// consume it for typed calls into apps/api; apps/api re-exports the
// schemas from `apps/api/src/schemas.ts` so the server validates with
// the same Zod definitions the clients build their requests against.

export { ApiClient } from './client';
export type { ApiClientOptions } from './client';
export { ApiError, ApiNetworkError } from './errors';
export {
  ApiErrorBodySchema,
  AuthExchangeRequestSchema,
  AuthExchangeResponseSchema,
  AuthLogoutResponseSchema,
  AuthRefreshRequestSchema,
  HaAccessBundleSchema,
  HaPasswordGrantErrorCode,
  HaPasswordGrantRequestSchema,
  HaPasswordGrantResponseSchema,
  SessionClaimsSchema,
  type ApiErrorBody,
  type AuthExchangeRequest,
  type AuthExchangeResponse,
  type AuthLogoutResponse,
  type AuthRefreshRequest,
  type AuthRefreshResponse,
  type HaAccessBundle,
  type HaPasswordGrantRequest,
  type HaPasswordGrantResponse,
  type SessionClaims,
} from './schemas';
export {
  CreateLayoutRequestSchema,
  LayoutListQuerySchema,
  LayoutListResponseSchema,
  LayoutPayloadSchema,
  LayoutSchema,
  UpdateLayoutRequestSchema,
  type CreateLayoutRequest,
  type Layout,
  type LayoutListQuery,
  type LayoutListResponse,
  type LayoutPayload,
  type UpdateLayoutRequest,
} from './layouts';
export {
  UserPreferencesSchema,
  UserPreferencesUpdateSchema,
  type UserPreferences,
  type UserPreferencesUpdate,
} from './me';
export {
  ApplyHaRequestSchema,
  ApplyHaResponseSchema,
  ApplyHaStepResultSchema,
  HaLayoutResponseSchema,
  type ApplyHaRequest,
  type ApplyHaResponse,
  type ApplyHaStepResult,
  type HaLayoutResponse,
} from './setup';
