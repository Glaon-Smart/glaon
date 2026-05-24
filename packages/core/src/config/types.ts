// Device-config schema — see ADR 0028. The wizard (epic #533) fills this blob
// progressively; `completedAt` is the bit that flips `isConfigured()` to true.
//
// Strict-mode parsing means an older Glaon's blob can survive only if every
// field it wrote is still on the schema. Bumping `schemaVersion` is the
// migration hook for the day that stops being true (see ADR 0028 — "Tekrar
// değerlendirme tetikleyicileri").

import { z } from 'zod';

/** Bumped when the persisted shape changes in a way old readers can't handle. */
export const DEVICE_CONFIG_SCHEMA_VERSION = 1 as const;

export const UnitSystemSchema = z.union([z.literal('metric'), z.literal('imperial')]);
export type UnitSystem = z.infer<typeof UnitSystemSchema>;

export const WifiConfigSchema = z.object({
  ssid: z.string().min(1),
  /**
   * Opaque to @glaon/core — the consumer decides what wrapping cipher to use
   * (Web Crypto AES-GCM on web, separate strategy on mobile). The schema only
   * enforces "non-empty string"; never plaintext.
   */
  passwordCipher: z.string().min(1),
});
export type WifiConfig = z.infer<typeof WifiConfigSchema>;

export const DeviceConfigSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_CONFIG_SCHEMA_VERSION),
    homeName: z.string().optional(),
    location: z.string().optional(),
    /** ISO 3166-1 alpha-2 (e.g. "TR", "US"). Uppercase. */
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, 'country must be ISO 3166-1 alpha-2 uppercase')
      .optional(),
    /**
     * Latitude (WGS84 decimal degrees, −90…+90). Optional companion
     * to `location` — present when the user picked the address via
     * `LocationPicker` (#579 / #590). Old wizard runs emitted
     * `location` as free text and these two fields stay undefined;
     * additive change keeps existing blobs parse-clean.
     */
    latitude: z.number().min(-90).max(90).optional(),
    /** Longitude (WGS84 decimal degrees, −180…+180). See `latitude`. */
    longitude: z.number().min(-180).max(180).optional(),
    /** IANA TZ name (e.g. "Europe/Istanbul"). */
    timezone: z.string().optional(),
    /** BCP-47 locale tag. SUPPORTED_LOCALES validation is the consumer's job. */
    locale: z.string().optional(),
    unitSystem: UnitSystemSchema.optional(),
    /** v1 free-text placeholder; real floor/room editor is a follow-up epic. */
    layout: z.string().optional(),
    wifi: WifiConfigSchema.optional(),
    /** SHA-256 hex (64 lowercase hex chars). Plaintext PIN never leaves the device. */
    securityPinHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'securityPinHash must be SHA-256 hex (64 lowercase chars)')
      .optional(),
    /**
     * Presence drives `ConfigStore.isConfigured()`. Set exactly once at the
     * end of the wizard via `markComplete()`. Empty schema (only this field)
     * is a valid "configured" state — fields can stay optional forever.
     */
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

/**
 * What `setPartial` accepts. `schemaVersion` is store-internal, `completedAt`
 * is set by `markComplete()` — neither belongs in user-facing form output.
 */
export type DeviceConfigInput = Partial<Omit<DeviceConfig, 'schemaVersion' | 'completedAt'>>;
