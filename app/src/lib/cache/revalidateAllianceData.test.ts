import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { revalidateAllianceData } from "./revalidateAllianceData";

describe("revalidateAllianceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws an error if allianceId is missing", () => {
    expect(() =>
      revalidateAllianceData({
        allianceId: "",
        domains: ["members"],
      })
    ).toThrow("allianceId is required for revalidation");
  });

  it("throws an error if evaluation-results is invalidated without periodId", () => {
    expect(() =>
      revalidateAllianceData({
        allianceId: "all_123",
        domains: ["evaluation-results"],
      })
    ).toThrow("periodId is required when invalidating evaluation results");
  });

  it("revalidating members invalidates list page and member detail route pattern", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      domains: ["members"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/members");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/[allianceId]/members/[memberId]", "page");
  });

  it("revalidating member-imports invalidates the history list and the per-import route pattern", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      domains: ["member-imports"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/members/imports");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/members/imports/[importId]",
      "page",
    );
  });

  it("revalidating evaluation-results invalidates period pages", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      periodId: "per_456",
      domains: ["evaluation-results"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456/record");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456/import");
  });

  it("handles multiple domains cleanly", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      periodId: "per_456",
      domains: ["members", "dashboard", "setup", "evaluation-results"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/members");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/[allianceId]/members/[memberId]", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/setup");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/setup/import");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456");
  });

  it("revalidating setup also covers the guided import route", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      domains: ["setup"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/setup");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/setup/import");
  });

  it("revalidating reports invalidates the index and the per-metric route pattern", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      domains: ["reports"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/reports");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});
