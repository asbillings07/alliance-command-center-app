/**
 * Marker base class for APS audit CLI errors that are safe to print
 * verbatim to stderr (#284 PR A review).
 *
 * The CLI entrypoint's top-level `.catch()` previously printed
 * `error.message` for every failure, including ones it never
 * constructed itself. Prisma/pg errors commonly embed the target
 * database host (e.g. "Can't reach database server at
 * `ep-xxx-pooler...`") and can otherwise echo query arguments -- exactly
 * the identity/allowlisted-tenant-id disclosure this audit's other
 * safety measures (the identity confirmation gate, the mandatory
 * allowlist, small-cell suppression) exist to prevent. An unexpected
 * failure reaching stderr/CI logs would silently bypass all of that.
 *
 * Every throw site that intentionally reports an operator-facing usage
 * problem -- missing/invalid CLI arguments, the target-identity
 * confirmation gate, the mandatory alliance-id allowlist -- constructs
 * this class (or a subclass) with a message that has already been
 * reviewed for safety (no raw ids, no connection strings, no query
 * details). The CLI entrypoint prints `.message` only for instances of
 * this class; anything else is treated as unexpected and its message is
 * suppressed entirely.
 */
export class AuditUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditUsageError";
  }
}
