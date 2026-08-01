import { describe, it, expect } from "vitest";
import { rankMetricRows } from "./rankMetricRows";

describe("rankMetricRows", () => {
  it("returns an empty array for no rows", () => {
    expect(rankMetricRows([])).toEqual([]);
  });

  it("assigns rank 1 to a single row", () => {
    expect(rankMetricRows([{ memberId: "m1", value: 100 }])).toEqual([
      { memberId: "m1", value: 100, rank: 1 },
    ]);
  });

  it("ranks strictly descending distinct values 1, 2, 3", () => {
    const result = rankMetricRows([
      { memberId: "low", value: 5 },
      { memberId: "high", value: 20 },
      { memberId: "mid", value: 10 },
    ]);

    expect(result).toEqual([
      { memberId: "high", value: 20, rank: 1 },
      { memberId: "mid", value: 10, rank: 2 },
      { memberId: "low", value: 5, rank: 3 },
    ]);
  });

  it("uses competition ranking for ties: 1, 1, 3 (not 1, 1, 2)", () => {
    const result = rankMetricRows([
      { memberId: "a", value: 10 },
      { memberId: "b", value: 10 },
      { memberId: "c", value: 5 },
    ]);

    const byMemberId = new Map(result.map((r) => [r.memberId, r.rank]));
    expect(byMemberId.get("a")).toBe(1);
    expect(byMemberId.get("b")).toBe(1);
    expect(byMemberId.get("c")).toBe(3);
  });

  it("handles a larger tie group: 1, 1, 1, 4", () => {
    const result = rankMetricRows([
      { memberId: "a", value: 10 },
      { memberId: "b", value: 10 },
      { memberId: "c", value: 10 },
      { memberId: "d", value: 1 },
    ]);

    const byMemberId = new Map(result.map((r) => [r.memberId, r.rank]));
    expect(byMemberId.get("a")).toBe(1);
    expect(byMemberId.get("b")).toBe(1);
    expect(byMemberId.get("c")).toBe(1);
    expect(byMemberId.get("d")).toBe(4);
  });

  it("gives every row rank 1 when all values are equal", () => {
    const result = rankMetricRows([
      { memberId: "a", value: 7 },
      { memberId: "b", value: 7 },
      { memberId: "c", value: 7 },
    ]);

    expect(result.every((r) => r.rank === 1)).toBe(true);
  });

  it("ranks negative values correctly (closer to zero ranks higher)", () => {
    const result = rankMetricRows([
      { memberId: "a", value: -10 },
      { memberId: "b", value: 0 },
      { memberId: "c", value: -5 },
    ]);

    const byMemberId = new Map(result.map((r) => [r.memberId, r.rank]));
    expect(byMemberId.get("b")).toBe(1);
    expect(byMemberId.get("c")).toBe(2);
    expect(byMemberId.get("a")).toBe(3);
  });

  it("does not mutate the input array", () => {
    const input = [
      { memberId: "a", value: 1 },
      { memberId: "b", value: 2 },
    ];
    const inputCopy = input.map((row) => ({ ...row }));
    rankMetricRows(input);
    expect(input).toEqual(inputCopy);
  });
});
