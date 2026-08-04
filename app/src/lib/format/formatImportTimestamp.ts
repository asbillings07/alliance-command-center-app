/**
 * Formats a durable import-history timestamp (`MemberImport.createdAt`) for
 * display on the Import History list/detail Server Components.
 *
 * Pins `timeZone: "UTC"` and visibly labels the result — a Server Component
 * rendering `Date.prototype.toLocaleString()` with no explicit time zone
 * renders the *server's* wall-clock time (which varies by deployment
 * region/runtime, not the viewer's), so an unlabeled local-looking timestamp
 * on permanent audit evidence would be silently wrong for most viewers.
 * Pinning to UTC keeps this Server Component (no client boundary needed
 * just to read the viewer's time zone) and keeps the rendered string
 * deterministic in tests regardless of the machine's local time zone.
 */
export function formatImportTimestamp(date: Date): string {
    const formatted = date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
    });
    return `${formatted} UTC`;
}
