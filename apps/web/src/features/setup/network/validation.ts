// Form-level network validation for the wizard's Network step (#629).
//
// These check *format* for the per-field inline errors the step shows.
// @glaon/core's NetworkConfigSchema enforces shape (non-empty strings)
// only — friendly IP-format feedback lives here in the UI layer, the
// same split that keeps `country` the lone regex-validated field on
// DeviceConfig. Pure functions, no DOM: trivially unit-testable.

/** RFC 1123 hostname label: 1–63 chars, letters/digits/hyphen, no edge hyphen. */
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isHostnameLabel(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

/** Dotted-quad IPv4, no leading zeros (each octet 0–255). */
export function isIpv4(value: string): boolean {
  const octets = value.split('.');
  if (octets.length !== 4) return false;
  return octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255 && String(Number(o)) === o);
}

/**
 * IPv6 with `::` compression. No embedded-IPv4 or zone-index forms —
 * uncommon for LAN config and not worth the validator surface. Each
 * group is 1–4 hex digits; `::` (at most once) stands in for one or more
 * zero groups.
 */
export function isIpv6(value: string): boolean {
  if (value === '' || (value.match(/::/g)?.length ?? 0) > 1) return false;
  const groupRe = /^[0-9a-fA-F]{1,4}$/;
  const hasCompression = value.includes('::');
  const parts = value.split('::');
  const head = parts[0] ?? '';
  const tail = parts[1] ?? '';
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const groups = [...headGroups, ...tailGroups];
  if (!groups.every((g) => groupRe.test(g))) return false;
  // `::` expands to >= 1 zero group, so head+tail must leave room (<= 7);
  // without compression the address must be exactly 8 groups.
  return hasCompression ? groups.length <= 7 : groups.length === 8;
}

/** Plain address of the given family (no prefix). */
export function isPlainIp(value: string, family: 'ipv4' | 'ipv6'): boolean {
  return family === 'ipv4' ? isIpv4(value) : isIpv6(value);
}

/**
 * Address with an optional CIDR prefix (e.g. `192.168.1.50/24`,
 * `fd00::1/64`). The prefix is optional but, when present, must be in
 * range for the family (0–32 for IPv4, 0–128 for IPv6).
 */
export function isCidr(value: string, family: 'ipv4' | 'ipv6'): boolean {
  const slash = value.indexOf('/');
  if (slash === -1) return isPlainIp(value, family);
  const addr = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!isPlainIp(addr, family)) return false;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const max = family === 'ipv4' ? 32 : 128;
  return Number(prefix) <= max;
}

/** Split a free-text DNS field on commas / whitespace into trimmed entries. */
export function splitNameservers(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** True when every entry in the DNS field is a valid plain address. */
export function areNameserversValid(value: string, family: 'ipv4' | 'ipv6'): boolean {
  const entries = splitNameservers(value);
  return entries.every((entry) => isPlainIp(entry, family));
}
