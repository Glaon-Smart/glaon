// IANA timezone list for the Home Overview wizard step (#540).
//
// `Intl.supportedValuesOf('timeZone')` returns ~430 IANA identifiers on
// every modern browser + Node 20+. In environments that do not
// implement it (very old browsers, restricted jsdom builds) the catch
// branch falls back to a tiny list rooted at UTC so the wizard still
// renders.

export function getTimezones(): readonly string[] {
  try {
    const supported = Intl.supportedValuesOf('timeZone');
    return [...supported].sort();
  } catch {
    return ['UTC', 'Europe/Istanbul', 'Europe/London', 'America/New_York'];
  }
}
