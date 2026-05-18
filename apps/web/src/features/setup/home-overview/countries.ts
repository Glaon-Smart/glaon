// Curated list of countries for the Home Overview wizard step (#540).
// V1 ships a short list of common markets so users can complete setup
// without scrolling 250+ ISO entries. Full ISO 3166-1 list is a
// follow-up alongside i18n for country names — the labels here stay
// English-only for now.
//
// Each entry holds the ISO 3166-1 alpha-2 code (uppercase per the
// DeviceConfig schema) plus a display label and a flag emoji computed
// from the code (`flagEmoji('TR')` → 🇹🇷). Keeping the list in this
// module rather than `@glaon/core` until a second feature needs it.

interface CountryEntry {
  readonly code: string;
  readonly label: string;
}

export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(0x1f1a5 + char.charCodeAt(0)))
    .join('');
}

export const COUNTRIES: readonly CountryEntry[] = [
  { code: 'TR', label: 'Türkiye' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'BE', label: 'Belgium' },
  { code: 'AT', label: 'Austria' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'SE', label: 'Sweden' },
  { code: 'NO', label: 'Norway' },
  { code: 'DK', label: 'Denmark' },
  { code: 'FI', label: 'Finland' },
  { code: 'IE', label: 'Ireland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'PL', label: 'Poland' },
  { code: 'CZ', label: 'Czechia' },
  { code: 'GR', label: 'Greece' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'IN', label: 'India' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
  { code: 'AR', label: 'Argentina' },
  { code: 'ZA', label: 'South Africa' },
];
