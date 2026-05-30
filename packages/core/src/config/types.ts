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

/**
 * Room category — drives the leading glyph in the layout editor and
 * lets HA bucket the room downstream (lighting / sensor templates,
 * default automations). Open-set on purpose: `'other'` is the
 * escape hatch for spaces that don't fit a canonical category.
 */
export const RoomTypeSchema = z.enum([
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'office',
  'dining',
  'garage',
  'garden',
  'other',
]);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const RoomSchema = z.object({
  /** Stable client-generated id (crypto.randomUUID()). Opaque. */
  id: z.string().min(1),
  /** User-facing name. Trimmed before persistence. 1–64 chars. */
  name: z.string().min(1).max(64),
  type: RoomTypeSchema.optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const FloorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  /** Empty array is valid — a floor without rooms is e.g. an attic. */
  rooms: z.array(RoomSchema).max(50),
});
export type Floor = z.infer<typeof FloorSchema>;

export const LayoutSchema = z.object({
  /** Always at least one floor; the editor blocks removing the last. */
  floors: z.array(FloorSchema).min(1).max(10),
});
export type Layout = z.infer<typeof LayoutSchema>;

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

/**
 * Supervisor IP-method vocabulary (matches HA's `ipv4`/`ipv6` `method`):
 * `auto` = DHCP / SLAAC, `static` = manual addressing, `disabled` = no
 * addressing on this family.
 */
export const IpMethodSchema = z.enum(['auto', 'static', 'disabled']);
export type IpMethod = z.infer<typeof IpMethodSchema>;

/**
 * Per-family (IPv4 or IPv6) addressing for one interface, mirroring the
 * HA Supervisor block. `address`/`gateway`/`nameservers` are only
 * meaningful when `method === 'static'`. The schema enforces *shape*
 * (non-empty strings), not IP semantics — friendlier per-field IP-format
 * validation lives in the wizard's form layer, the same split that keeps
 * `country` the only regex-validated field on DeviceConfig.
 */
export const IpConfigSchema = z.object({
  method: IpMethodSchema,
  /** CIDR strings, e.g. "192.168.1.50/24". Present for static config. */
  address: z.array(z.string().min(1)).max(8).optional(),
  gateway: z.string().min(1).optional(),
  /** DNS servers, in priority order. */
  nameservers: z.array(z.string().min(1)).max(8).optional(),
});
export type IpConfig = z.infer<typeof IpConfigSchema>;

/**
 * One network interface's collected IP config. `name` matches the
 * Supervisor interface id (e.g. "end0", "wlan0"). Wi-Fi credentials stay
 * on `DeviceConfig.wifi`; this block is wired/wireless addressing only.
 */
export const InterfaceConfigSchema = z.object({
  name: z.string().min(1),
  ipv4: IpConfigSchema.optional(),
  ipv6: IpConfigSchema.optional(),
});
export type InterfaceConfig = z.infer<typeof InterfaceConfigSchema>;

/**
 * Device-level network settings collected in the wizard's Network step
 * (#629): the LAN hostname + per-interface IPv4/IPv6. Fully optional and
 * additive — blobs written before this field parse clean, so no
 * `schemaVersion` bump (same reasoning as latitude/longitude/layout).
 */
export const NetworkConfigSchema = z.object({
  /**
   * RFC 1123 hostname label: 1–63 chars of letters, digits, and hyphens,
   * with no leading or trailing hyphen. Case is preserved here; the
   * Supervisor lowercases and re-validates host-side on commit.
   */
  hostname: z
    .string()
    .regex(
      /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
      'hostname must be an RFC 1123 label (1–63 chars: letters, digits, hyphen; no leading/trailing hyphen)',
    )
    .optional(),
  interfaces: z.array(InterfaceConfigSchema).max(16).optional(),
});
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;

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
    /** ISO 4217 currency code (e.g. "TRY", "USD"). Uppercase. Collected in
     *  the wizard's Home Overview step (#649); maps to HA Core `currency`. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'currency must be ISO 4217 alpha-3 uppercase')
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
    /**
     * Multi-floor layout collected in wizard step 2. Each floor
     * carries a list of rooms; the optional `type` per room drives
     * the leading glyph in the editor and lets HA categorise the
     * room downstream when the layout is mapped to HA areas
     * (separate epic).
     *
     * Replaces the v1 free-text string from #545. Phase 2 has no
     * production blobs that wrote the old shape, so the swap is
     * direct — no `schemaVersion` bump. Local-dev blobs with the
     * stale string field will fail strict parse and the wizard
     * re-runs, which is acceptable for pre-release.
     */
    layout: LayoutSchema.optional(),
    wifi: WifiConfigSchema.optional(),
    /**
     * LAN hostname + per-interface IPv4/IPv6 collected in the wizard's
     * Network step (#629). Optional + additive; see NetworkConfigSchema.
     * The terminal commit pushes hostname to the Supervisor host API and
     * the IP config to `/network/interface/{iface}/update`.
     */
    network: NetworkConfigSchema.optional(),
    /**
     * Local device admin username (#640), paired with `securityPinHash`
     * for re-entering setup. A plain identifier, not a secret: 3–32 chars
     * of letters, digits, dot, underscore, hyphen. Required in the
     * wizard's Security step; optional here so partial blobs parse.
     */
    adminUsername: z
      .string()
      .regex(
        /^[A-Za-z0-9._-]{3,32}$/,
        'adminUsername must be 3–32 chars: letters, digits, dot, underscore, hyphen',
      )
      .optional(),
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
