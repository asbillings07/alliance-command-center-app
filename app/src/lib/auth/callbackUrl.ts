import { sanitizeInternalPath } from "../internalPath";

/**
 * Sanitize a post-authentication callback URL.
 *
 * Only same-origin relative paths are allowed, preventing open-redirect attacks.
 * Anything else falls back to "/app". Delegates the safety check to the shared
 * `sanitizeInternalPath` so callback and tour-return sanitization stay identical.
 */
export function sanitizeCallbackUrl(url: string | undefined | null): string {
  return sanitizeInternalPath(url) ?? "/app";
}
