import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Pulled in transitively via @/app/src/components/client's GoogleSignInButton/
// SignOutButton (real next-auth setup, unusable in this test environment).
vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/app/src/lib/featureFlags/evaluateFeature", () => ({
  evaluateFeature: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/reports/getMetricSummaryReport", () => ({
  getMetricSummaryReport: vi.fn(),
  MetricSummaryReportNotFoundError: class MetricSummaryReportNotFoundError extends Error {},
  normalizeSort: vi.fn(),
  normalizeFilter: vi.fn(),
}));

vi.mock("@/app/src/lib/reports/resolveDefaultReportPeriod", () => ({
  resolveDefaultReportPeriod: vi.fn(),
}));

vi.mock("@/app/src/lib/reports/listReportPeriodOptions", () => ({
  listReportPeriodOptions: vi.fn(),
}));

import { notFound } from "next/navigation";
import { evaluateFeature } from "@/app/src/lib/featureFlags/evaluateFeature";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import MetricReportPage from "./page";

describe("MetricReportPage (Server Page) — FEATURE_REPORTS gate (#190)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed with notFound() when the reports feature flag is off, before any auth/DB work happens", async () => {
    vi.mocked(evaluateFeature).mockResolvedValue(false);

    await expect(
      MetricReportPage({
        params: Promise.resolve({ allianceId: "all_1", metricId: "met_1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(requireAllianceAccess).not.toHaveBeenCalled();
  });
});
