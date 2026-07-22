/**
 * Sanitize an untrusted, same-origin internal path.
 *
 * Returns the path unchanged when it is a safe same-origin relative path, or
 * `null` when it is anything else (absolute/protocol-relative URLs, backslash
 * tricks, control characters, executable schemes like `javascript:`). This is
 * the single source of truth for "is this a safe internal path to navigate to",
 * shared by post-auth callback URLs and post-tour return URLs so the two can't
 * drift. Callers decide what to do with `null` (fall back, or don't navigate).
 */
export function sanitizeInternalPath(
  value: string | undefined | null
): string | null {
  // Must be a relative path rooted at "/". "//host" is protocol-relative (an
  // absolute URL) and is rejected, as is anything not starting with "/"
  // (including "javascript:...", "https://...", bare words).
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  // Reject backslashes (raw or percent-encoded) and control characters.
  // Backslashes are normalized to forward slashes inconsistently by user agents
  // and are a common open-redirect bypass (e.g. "/\evil.com" or "/%5cevil.com").
  if (/\\/.test(value) || /%5c/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  // Final guard: resolving against a dummy origin must keep that origin, i.e.
  // the value cannot escape to another host.
  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return null;
    }
  } catch {
    return null;
  }

  return value;
}
