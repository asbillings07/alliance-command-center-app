import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { rankingFixture } from "./testing/rankingFixture";
import { readRankingContext } from "./rankingContext";
import { rankingWindow, reconcileOverlap, reviewRanking, showCurrentDayProgress, type RankingRecognition, type BatchCandidate } from "./ranking";

const members = ["Jordan Vale", "Morgan Reed", "Riley Chen"].map((playerName, i) => ({ id: String(i), playerName, archived: false }));
const sample = (): RankingRecognition => ({ ...rankingFixture().recognition, rankingContext: { kind: "daily", weekday: 1, label: "Monday" } });
describe("leader ranking screenshots", () => {
  it.each([["monday", { kind: "daily", weekday: 1 }], ["tuesday", { kind: "daily", weekday: 2 }], ["weekly", { kind: "weekly" }], ["missing", { kind: "missing" }]] as const)("reads highlighted %s context from pixels even when both tab labels are present", async (kind, expected) => {
    const fixture = rankingFixture(kind);
    expect(await readRankingContext(await sharp(Buffer.from(fixture.svg)).png().toBuffer(), fixture.recognition)).toMatchObject(expected);
  });
  it("extracts every complete ranking row and binds each name to its own points", () => {
    expect(reviewRanking(sample(), members).rows.map(r => [r.sourceName, r.value, r.status])).toEqual([
      ["Jordan Vale", 23340000, "exact"], ["Morgan Reed", 19317601, "exact"], ["Riley Chen", 17512500, "exact"],
    ]);
  });
  it("extracts all visible Duel rows without per-member provider calls", () => {
    const review = reviewRanking({ text: "ALLIANCE DUEL Today's Duel 23:39:25", rankingContext: { kind: "today", label: "Today's Duel" }, words: [
      { text: "[QA]Jordan Vale", x: 150, y: 350, width: 240, height: 26 },
      { text: "23,340,000", x: 220, y: 395, width: 180, height: 26 },
      { text: "[QA]Morgan Reed", x: 150, y: 460, width: 240, height: 26 },
      { text: "19,317,601", x: 220, y: 505, width: 180, height: 26 },
    ] }, members);
    expect(review.rows.map(r => [r.sourceName, r.value])).toEqual([["Jordan Vale", 23340000], ["Morgan Reed", 19317601]]);
  });
  it("requires visible source context, not a user-supplied date alone", () => {
    const input = sample(); delete input.rankingContext;
    expect(reviewRanking(input, members).rows).toEqual([]);
  });
  it("does not silently promote fuzzy matching, duplicate names, or archived members", () => {
    const roster = [{ ...members[0], playerName: "Jordan Vole" }, { ...members[1], archived: true }, members[2], { ...members[2], id: "other" }];
    expect(reviewRanking(sample(), roster).rows.map(r => r.status)).toEqual(["suggested", "archived", "ambiguous"]);
  });
  it("keeps cropped or unreadable names unresolved instead of borrowing a neighbouring name", () => {
    const input = sample(); input.words = input.words.filter(w => w.text !== "Morgan Reed");
    expect(reviewRanking(input, members).rows[1]).toMatchObject({ sourceName: "", status: "invalid" });
  });
  it("uses the canonical import number grammar and refuses malformed or oversized values", () => {
    const input = sample(); input.words.find(w => w.text === "23,340,000")!.text = "23.340.000";
    input.words.find(w => w.text === "19,317,601")!.text = "19,31,601";
    input.words.find(w => w.text === "17,512,500")!.text = "9,999,999,999";
    expect(reviewRanking(input, members).rows.map(r => r.value)).toEqual([23340000, null, null]);
  });
  it("derives daily dates only from a valid selected Monday and keeps weekly windows distinct", () => {
    expect(rankingWindow({ kind: "daily", weekday: 2, label: "Tuesday" }, "2026-11-16")).toBe("2026-11-17");
    expect(rankingWindow({ kind: "weekly", label: "Weekly Rank" }, "2026-11-16")).toBe("week:2026-11-16");
    for (const date of ["", "2026-02-30", "2026-11-17"]) expect(rankingWindow({ kind: "daily", weekday: 1, label: "Monday" }, date)).toBeNull();
  });
  it("shows the progress notice only for a confirmed current-day timer; absence never means final", () => {
    const now = new Date("2026-11-18T00:30:00Z");
    const review = { context: { kind: "today" as const, label: "Today's Duel" as const }, countdown: "00:30:00", rows: [] };
    expect(showCurrentDayProgress(review, "2026-11-17", now)).toBe(true);
    expect(showCurrentDayProgress(review, "2026-11-18", now)).toBe(false);
    expect(showCurrentDayProgress(review, null, now)).toBe(false);
    expect(showCurrentDayProgress({ ...review, countdown: "00:00:00" }, "2026-11-17", now)).toBe(false);
    expect(showCurrentDayProgress({ ...review, countdown: null }, "2026-11-17", now)).toBe(false);
    expect(showCurrentDayProgress({ ...review, context: { kind: "weekly", label: "Weekly Rank" } }, "2026-11-17", now)).toBe(false);
    expect(showCurrentDayProgress(review, "2026-11-17", new Date("2026-11-18T01:00:00Z"))).toBe(false);
  });
  it("collapses identical overlaps but exposes conflicts without mixing days and weeks", () => {
    const row = reviewRanking(sample(), members).rows[0];
    const base: BatchCandidate = { ...row, attemptId: "a", window: "2026-11-16", source: 1 };
    const result = reconcileOverlap([base, { ...base, attemptId: "b", source: 2 }, { ...base, window: "week:2026-11-16" }, { ...base, window: "2026-11-17" }]);
    expect(result).toHaveLength(3); expect(result[0]).toMatchObject({ duplicates: 1, conflict: false });
    expect(reconcileOverlap([base, { ...base, value: 1, attemptId: "b" }])[0].conflict).toBe(true);
  });
});
