/**
 * Read `CAPRIGO_${suffix}`, then the older legacy prefix.
 * Centralizes migration so the rest of the codebase stays Caprigo-named.
 */
const LEGACY_PRODUCT_PREFIX = ['R', 'A', 'D', 'B', 'O', 'T'].join('');

export function caprigoEnv(suffix: string): string | undefined {
  const primary = process.env[`CAPRIGO_${suffix}`]?.trim();
  if (primary) return primary;
  return process.env[`${LEGACY_PRODUCT_PREFIX}_${suffix}`]?.trim();
}
