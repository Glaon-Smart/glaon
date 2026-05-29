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

/** Parse a dotted IPv4 string into its unsigned 32-bit value. */
function ipv4ToInt(value: string): number {
  return (
    value.split('.').reduce((acc, octet) => ((acc * 256 + Number(octet)) >>> 0) >>> 0, 0) >>> 0
  );
}

/**
 * Valid IPv4 subnet mask — a dotted quad whose bits are a contiguous run
 * of high 1s (e.g. 255.255.255.0, 255.255.0.0). Rejects non-contiguous
 * masks like 255.0.255.0.
 */
export function isIpv4Netmask(value: string): boolean {
  if (!isIpv4(value)) return false;
  const inv = ~ipv4ToInt(value) >>> 0;
  // For a contiguous high-bit mask the inverse is all-1s in the low bits,
  // so `inv & (inv + 1)` clears to zero.
  return (inv & (inv + 1)) >>> 0 === 0;
}

/** Valid IPv6 prefix length — an integer 0–128. */
export function isIpv6Prefix(value: string): boolean {
  return /^\d{1,3}$/.test(value) && Number(value) <= 128;
}

/** Bit count of a (valid, contiguous) IPv4 dotted mask → prefix length. */
export function netmaskToPrefix(mask: string): number {
  let n = ipv4ToInt(mask);
  let count = 0;
  while (n !== 0) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

/** IPv4 prefix length (0–32) → dotted subnet mask. */
export function prefixToNetmask(prefix: number): string {
  const m = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(m >>> 24) & 0xff, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff].join('.');
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
