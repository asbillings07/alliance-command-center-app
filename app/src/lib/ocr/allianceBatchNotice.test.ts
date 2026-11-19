import { describe, expect, it } from "vitest";
import { allianceBatchNotice, isAllianceRejection } from "./allianceEvidence";

const foreign = { state: "blocked", outcome: "alliance-mismatch" };
describe("batch alliance notice", () => {
  it("announces that all sources mismatch only after every source is checked", () => {
    expect(allianceBatchNotice([foreign, { ...foreign, outcome: "alliance-server-mismatch" }])).toEqual({ count: 2, allForeign: true });
    expect(allianceBatchNotice([foreign])).toEqual({ count: 1, allForeign: true });
  });
  it.each(["queued", "reading", "failed", "ready"])("never treats %s as proof of another alliance", state => {
    expect(allianceBatchNotice([foreign, { state }])).toBeNull();
  });
  it("distinguishes unreadable/mixed evidence from confirmed foreign sources", () => {
    expect(allianceBatchNotice([foreign, { state: "blocked", outcome: "alliance-missing" }])).toEqual({ count: 2, allForeign: false });
    expect(allianceBatchNotice([{ state: "blocked", outcome: "alliance-mixed" }])).toEqual({ count: 1, allForeign: false });
  });
  it("ignores empty and unknown-outcome batches", () => {
    expect(allianceBatchNotice([])).toBeNull();
    expect(allianceBatchNotice([{ state: "blocked", outcome: "processing-failed" }])).toBeNull();
    for (const value of [null, undefined, "alliance-mismatch", { outcome: "internal-error" }, { outcome: 3 }]) expect(isAllianceRejection(value)).toBe(false);
  });
});
