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

vi.mock("@/app/src/lib/features", () => ({
  isFeatureEnabled: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: {
      findMany: vi.fn(),
    },
  },
}));

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/app/src/lib/features";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import ReportsIndexPage from "./page";

describe("ReportsIndexPage (Server Page) — FEATURE_REPORTS gate (#190)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed with notFound() when the reports feature flag is off, before any auth/DB work happens", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    await expect(
      ReportsIndexPage({ params: Promise.resolve({ allianceId: "all_1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(requireAllianceAccess).not.toHaveBeenCalled();
  });

  it("proceeds to authorization when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: { canConfigureMetrics: false },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    const { prisma } = await import("@/app/src/lib/prisma");
    vi.mocked(prisma.metric.findMany).mockResolvedValue([]);

    await ReportsIndexPage({ params: Promise.resolve({ allianceId: "all_1" }) });

    expect(requireAllianceAccess).toHaveBeenCalledTimes(1);
  });
});
