import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../allianceSetup", () => ({
  getAllianceSetupStatus: vi.fn(),
}));

import { getAllianceSetupStatus } from "../allianceSetup";
import { getAllianceSetupStatusById } from "./alliances";

function mockSetupStatus(
  overrides: Partial<Awaited<ReturnType<typeof getAllianceSetupStatus>>> = {}
) {
  return {
    tasks: [],
    isComplete: false,
    completedCount: 0,
    totalCount: 4,
    requiredComplete: 0,
    requiredTotal: 4,
    targetPeriodId: null,
    hasArchivedPeriodsOnly: false,
    activeMemberCount: 0,
    recommendedTask: null,
    ...overrides,
  };
}

describe("getAllianceSetupStatusById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns incomplete when active period lacks assigned metrics/results", async () => {
    vi.mocked(getAllianceSetupStatus).mockResolvedValue(
      mockSetupStatus({
        isComplete: false,
        targetPeriodId: "period-active",
        requiredComplete: 2,
      })
    );

    await expect(getAllianceSetupStatusById("alliance-1")).resolves.toBe(
      "incomplete"
    );
    expect(getAllianceSetupStatus).toHaveBeenCalledWith("alliance-1");
  });

  it("returns incomplete when only archived periods exist", async () => {
    vi.mocked(getAllianceSetupStatus).mockResolvedValue(
      mockSetupStatus({
        isComplete: false,
        hasArchivedPeriodsOnly: true,
        requiredComplete: 0,
      })
    );

    await expect(getAllianceSetupStatusById("alliance-1")).resolves.toBe(
      "incomplete"
    );
  });

  it("returns complete when setup is fully complete", async () => {
    vi.mocked(getAllianceSetupStatus).mockResolvedValue(
      mockSetupStatus({
        isComplete: true,
        requiredComplete: 4,
        targetPeriodId: "period-active",
      })
    );

    await expect(getAllianceSetupStatusById("alliance-1")).resolves.toBe(
      "complete"
    );
  });

  it("returns unavailable when getAllianceSetupStatus throws", async () => {
    vi.mocked(getAllianceSetupStatus).mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(getAllianceSetupStatusById("alliance-1")).resolves.toBe(
      "unavailable"
    );
  });
});
