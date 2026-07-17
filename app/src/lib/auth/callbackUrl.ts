/**
 * Sanitize a post-authentication callback URL.
 *
 * Only same-origin relative paths are allowed, preventing open-redirect attacks.
 * Anything else falls back to "/app".
 */
export function sanitizeCallbackUrl(url: string | undefined | null): string {
  const fallback = "/app";

  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return fallback;
  }

  // Reject backslashes (raw or percent-encoded) and control characters.
  // Backslashes are normalized to forward slashes inconsistently by user agents
  // and are a common open-redirect bypass (e.g. "/\evil.com" or "/%5cevil.com").
  if (/\\/.test(url) || /%5c/i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) {
    return fallback;
  }

  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return url;
}
