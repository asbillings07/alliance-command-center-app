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

  it("revalidating members uses layout invalidation on /members", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      domains: ["members"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/members", "layout");
  });

  it("revalidating evaluation-results invalidates period pages", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      periodId: "per_456",
      domains: ["evaluation-results"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456/record", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456/import", "page");
  });

  it("deduplicates paths across multiple domains", () => {
    revalidateAllianceData({
      allianceId: "all_123",
      periodId: "per_456",
      domains: ["members", "dashboard", "setup", "evaluation-results"],
    });

    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/members", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/setup", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/all_123/periods/per_456", "page");
  });
});
