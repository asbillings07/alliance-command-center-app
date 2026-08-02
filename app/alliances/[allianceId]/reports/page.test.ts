import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Pulled in transitively via @/app/src/components/client's GoogleSignInButton/
// SignOutButton (real next-auth setup, unusable in this test environment).
vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // The period/comparison selectors are client components that call these
  // hooks; renderToStaticMarkup has no real Next.js router context, so they
  // must be stubbed for a full-page render to succeed.
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/src/lib/features", () => ({
  isFeatureEnabled: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/reports/listAlliancePeriodOptions", () => ({
  listAlliancePeriodOptions: vi.fn(),
}));

vi.mock("@/app/src/lib/reports/getAlliancePerformanceReport", () => ({
  getAlliancePerformanceReport: vi.fn(),
  AlliancePerformanceReportNotFoundError: class AlliancePerformanceReportNotFoundError extends Error {},
}));

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/app/src/lib/features";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { listAlliancePeriodOptions } from "@/app/src/lib/reports/listAlliancePeriodOptions";
import {
  getAlliancePerformanceReport,
  AlliancePerformanceReportNotFoundError,
} from "@/app/src/lib/reports/getAlliancePerformanceReport";
import ReportsIndexPage from "./page";

const viewerAuth = { permissions: { canConfigurePeriods: false, canConfigureMetrics: false } } as unknown as Awaited<
  ReturnType<typeof requireAllianceAccess>
>;

function emptyReport(overrides: Partial<Awaited<ReturnType<typeof getAlliancePerformanceReport>>> = {}) {
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date(),
    allianceId: "all_1",
    period: { id: "per_1", name: "Week 1", startsAt: null, endsAt: null, active: true },
    comparisonSelection: { status: "NO_ELIGIBLE_PERIOD" as const },
    metrics: [],
    overallCoverage: {
      activeAttachmentCount: 0,
      notAttachedCount: 0,
      inactiveAttachmentCount: 0,
      expectedCells: 0,
      validCells: 0,
      coveragePercent: null,
    },
    ...overrides,
  };
}

describe("ReportsIndexPage (Server Page) — alliance performance overview (#264)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue(viewerAuth);
  });

  it("fails closed with notFound() when the reports feature flag is off, before any auth/DB work happens", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    await expect(
      ReportsIndexPage({ params: Promise.resolve({ allianceId: "all_1" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(requireAllianceAccess).not.toHaveBeenCalled();
  });

  it("shows a 'no evaluation periods' empty state and never queries the report when the alliance has none", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([]);

    const page = await ReportsIndexPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No evaluation periods configured yet");
    expect(getAlliancePerformanceReport).not.toHaveBeenCalled();
  });

  it("falls back to the newest configured period when there's no active one", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([{ id: "per_archived", name: "Old Period", active: false }]);
    vi.mocked(getAlliancePerformanceReport).mockResolvedValue(emptyReport());

    await ReportsIndexPage({ params: Promise.resolve({ allianceId: "all_1" }), searchParams: Promise.resolve({}) });

    expect(getAlliancePerformanceReport).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "all_1", periodId: "per_archived" }),
    );
  });

  it("defaults to the active period when one exists, even if a chronologically newer (but inactive) period sorts first", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([
      { id: "per_newest", name: "Newest (inactive)", active: false },
      { id: "per_active", name: "Currently Active", active: true },
    ]);
    vi.mocked(getAlliancePerformanceReport).mockResolvedValue(emptyReport());

    await ReportsIndexPage({ params: Promise.resolve({ allianceId: "all_1" }), searchParams: Promise.resolve({}) });

    expect(getAlliancePerformanceReport).toHaveBeenCalledWith(
      expect.objectContaining({ allianceId: "all_1", periodId: "per_active" }),
    );
  });

  it("shows a 'no metrics configured' empty state when the metric universe is empty for this period", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([{ id: "per_1", name: "Week 1", active: true }]);
    vi.mocked(getAlliancePerformanceReport).mockResolvedValue(emptyReport());

    const page = await ReportsIndexPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No metrics configured yet");
  });

  it("fails closed with notFound() when an explicit periodId in the URL doesn't belong to this alliance", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([{ id: "per_1", name: "Week 1", active: true }]);
    vi.mocked(getAlliancePerformanceReport).mockRejectedValue(new AlliancePerformanceReportNotFoundError());

    await expect(
      ReportsIndexPage({
        params: Promise.resolve({ allianceId: "all_1" }),
        searchParams: Promise.resolve({ periodId: "not-this-alliance" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders the at-a-glance cards and one performance card per metric in the returned order", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([{ id: "per_1", name: "Week 1", active: true }]);
    vi.mocked(getAlliancePerformanceReport).mockResolvedValue(
      emptyReport({
        overallCoverage: {
          activeAttachmentCount: 1,
          notAttachedCount: 1,
          inactiveAttachmentCount: 0,
          expectedCells: 10,
          validCells: 7,
          coveragePercent: 70,
        },
        metrics: [
          {
            metric: { id: "met_1", name: "Donations", type: "NUMERIC", summaryKind: "SUM", unitLabel: "pts", active: true },
            attachmentStatus: "ACTIVE",
            dataStatus: "HAS_VALUES",
            rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
            coverage: {
              currentActiveMemberCount: 10,
              recordedActiveMemberCount: 7,
              invalidActiveMemberCount: 0,
              missingActiveMemberCount: 3,
              complete: false,
              archivedContributingMemberCount: 0,
            },
            comparison: null,
          },
          {
            metric: { id: "met_2", name: "Never Attached", type: "NUMERIC", summaryKind: "SUM", unitLabel: null, active: true },
            attachmentStatus: "NOT_ATTACHED",
            dataStatus: "NO_VALUES",
            rollup: { kind: "SUM", total: 0, hasNegativeValues: false },
            coverage: {
              currentActiveMemberCount: 10,
              recordedActiveMemberCount: 0,
              invalidActiveMemberCount: 0,
              missingActiveMemberCount: 10,
              complete: false,
              archivedContributingMemberCount: 0,
            },
            comparison: null,
          },
        ],
      }) as unknown as Awaited<ReturnType<typeof getAlliancePerformanceReport>>,
    );

    const page = await ReportsIndexPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("alliance-metric-card-met_1");
    expect(html).toContain("Donations");
    expect(html).toContain("alliance-metric-card-met_2");
    expect(html).toContain("Never Attached");
    expect(html).toContain("Not attached");
    expect(html).toContain("70%");
    expect(html).toContain('href="/alliances/all_1/reports/metrics/met_1?periodId=per_1"');
  });

  it("carries the resolved shared comparison period into every card's drill-down link, so it isn't silently re-resolved differently there", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(listAlliancePeriodOptions).mockResolvedValue([{ id: "per_1", name: "Week 1", active: true }]);
    vi.mocked(getAlliancePerformanceReport).mockResolvedValue(
      emptyReport({
        comparisonSelection: {
          status: "RESOLVED",
          period: { id: "per_prev", name: "Week 0" },
          eligiblePeriods: [],
        },
        metrics: [
          {
            metric: { id: "met_1", name: "Donations", type: "NUMERIC", summaryKind: "SUM", unitLabel: "pts", active: true },
            attachmentStatus: "ACTIVE",
            dataStatus: "HAS_VALUES",
            rollup: { kind: "SUM", total: 500, hasNegativeValues: false },
            coverage: {
              currentActiveMemberCount: 10,
              recordedActiveMemberCount: 7,
              invalidActiveMemberCount: 0,
              missingActiveMemberCount: 3,
              complete: false,
              archivedContributingMemberCount: 0,
            },
            comparison: { status: "NOT_ATTACHED" },
          },
        ],
      }) as unknown as Awaited<ReturnType<typeof getAlliancePerformanceReport>>,
    );

    const page = await ReportsIndexPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain(
      'href="/alliances/all_1/reports/metrics/met_1?periodId=per_1&amp;comparePeriodId=per_prev"',
    );
  });
});
