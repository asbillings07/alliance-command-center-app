/** Optional browser-reported revision for diagnostics. Older tabs omit it. */
export function readClientBuild(value: unknown): string | null {
  return typeof value === "string" && value.length === 7 && !/[^a-f0-9]/.test(value) ? value : null;
}
