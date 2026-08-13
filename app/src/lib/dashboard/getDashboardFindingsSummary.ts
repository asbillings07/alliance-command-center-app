import "server-only";
import { getAlliancePerformanceReport } from "@/app/src/lib/reports/getAlliancePerformanceReport";
import { computeAllianceFindings, type AllianceFinding } from "@/app/src/lib/reports/allianceFindings";

/**
 * Dashboard "needs attention" contract (#192/#332 phase 1).
 *
 * This is the single, explicit boundary between the Reports domain's
 * finding semantics and the dashboard's "Participation and evaluation"
 * group. Nothing else in the dashboard reasons about `AllianceFinding`
 * directly — everything routes through this file, so the contract below is
 * the *only* place drift between Reports and the dashboard can be
 * introduced, and the only place it needs defending.
 *
 * Contract:
 *
 * 1. **Included kinds** — `DASHBOARD_ACTIONABLE_FINDING_KINDS` is a
 *    `Record<AllianceFinding["kind"], boolean>`, not a partial list. If
 *    `allianceFindings.ts` ever adds a new `AllianceFinding` kind, this file
 *    fails to compile until someone explicitly decides whether the
 *    dashboard should count it — the report engine can never silently
 *    change dashboard behavior by adding a kind.
 *
 *    Included today: `MISSING_RESULTS`, `INVALID_VALUES`,
 *    `INCOMPLETE_COVERAGE`, `NOT_ATTACHED`, `INACTIVE_ATTACHMENT` — every
 *    kind that names something a leader can resolve *right now* for the
 *    selected period, independent of any comparison period.
 *
 *    Excluded today: `ADVERSE_COMPARISON`, `COMPARISON_UNAVAILABLE` — both
 *    are about trend against a *comparison* period. This adapter never
 *    requests one (see point 3), so a comparison period is never in effect
 *    and neither kind can ever actually appear in practice; they are listed
 *    explicitly as `false` anyway so the exhaustiveness guarantee above
 *    covers the full union, not just the kinds this call site happens to
 *    produce today.
 *
 * 2. **Null/void data handling** — zero attached metrics, zero roster
 *    members, and a period with no attachments at all each resolve to
 *    `actionableFindingCount: 0`, never a thrown error. This follows
 *    directly from `computeAllianceFindings`'s own behavior (an empty
 *    `metrics` array produces no findings) — nothing extra is needed here.
 *
 * 3. **Tenant-scoped filtering semantics** — this adapter performs no
 *    scoping of its own. It inherits `getAlliancePerformanceReport`'s
 *    existing `allianceId`-scoped period lookup verbatim: that function
 *    looks up `periodId` scoped to `allianceId` and throws
 *    `AlliancePerformanceReportNotFoundError` for a period belonging to a
 *    different alliance, so a cross-tenant `periodId` can never leak
 *    findings here. See `getDashboardFindingsSummary.integration.test.ts`
 *    for the explicit cross-alliance regression test.
 *
 * 4. **Ordering** — `computeAllianceFindings` already returns findings in a
 *    fixed, deterministic severity-priority order (see its own doc
 *    comment). This adapter filters that array without re-sorting it, so
 *    if a future revision exposes more than a count, the order a leader
 *    sees is provably the same order Reports would show for the same
 *    findings.
 *
 * 5. **Stable output shape** — `{ actionableFindingCount: number }`. Any
 *    future addition (e.g. a top finding) is a new field, not a
 *    reinterpretation of this one.
 *
 * Deliberately excluded from this call: a comparison period.
 * `getAlliancePerformanceReport` is called with only `allianceId` and
 * `periodId` — omitting `comparePeriodId` skips the second
 * `memberPeriodMetricValues` round-trip for a comparison period the
 * dashboard doesn't need, which is also *why* the two comparison-only
 * finding kinds are excluded (point 1): with no comparison period in
 * effect, `comparison` is always null and neither kind is ever produced.
 */
export const DASHBOARD_ACTIONABLE_FINDING_KINDS: Record<AllianceFinding["kind"], boolean> = {
  MISSING_RESULTS: true,
  INVALID_VALUES: true,
  INCOMPLETE_COVERAGE: true,
  NOT_ATTACHED: true,
  INACTIVE_ATTACHMENT: true,
  ADVERSE_COMPARISON: false,
  COMPARISON_UNAVAILABLE: false,
};

export type DashboardFindingsSummary = {
  actionableFindingCount: number;
};

/**
 * Pure filter over an already-computed findings list — separated from the
 * DB-calling wrapper below so the contract's filtering behavior (point 1
 * above) is unit-testable directly against hand-built `AllianceFinding`
 * fixtures, with no report/DB fixture required.
 */
export function countActionableFindings(findings: readonly AllianceFinding[]): number {
  return findings.filter((finding) => DASHBOARD_ACTIONABLE_FINDING_KINDS[finding.kind]).length;
}

export async function getDashboardFindingsSummary(params: {
  allianceId: string;
  periodId: string;
}): Promise<DashboardFindingsSummary> {
  const { allianceId, periodId } = params;
  if (!allianceId || !periodId) {
    throw new Error("allianceId and periodId are required");
  }

  const report = await getAlliancePerformanceReport({ allianceId, periodId });
  const findings = computeAllianceFindings(report.metrics);

  return { actionableFindingCount: countActionableFindings(findings) };
}
