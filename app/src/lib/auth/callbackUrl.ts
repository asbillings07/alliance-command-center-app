/**
 * Sanitize a post-authentication callback URL.
 *
 * Only same-origin relative paths are allowed, preventing open-redirect attacks.
 * Anything else falls back to "/app".
 */
export function sanitizeCallbackUrl(url: string | undefined | null): string {
  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return "/app";
  }
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return "/app";
    }
  } catch {
    return "/app";
  }
  return url;
}
