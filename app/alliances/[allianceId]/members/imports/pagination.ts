export const PAGE_SIZE = 25;

/**
 * Clamps a raw `?page=` query param to a real page number.
 *
 * Non-numeric, missing, or out-of-range values collapse to page 1 (or the
 * last real page when the request is beyond it) rather than a 500 or a
 * silently empty page — mirrors clampRequestedPage/resolvePageAgainstTotal
 * in getMetricSummaryReport.ts.
 */
export function resolveImportHistoryPage(rawPage: string | undefined, totalPages: number): number {
    const parsed = rawPage !== undefined ? Number(rawPage) : 1;
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return Math.min(Math.floor(parsed), Math.max(1, totalPages));
}
