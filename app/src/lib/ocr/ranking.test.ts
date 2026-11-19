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
  it("handles centered column headers and large rank glyphs without losing the name column", () => {
    const input: RankingRecognition = { text: "Ranking Commander Points", rankingContext: { kind: "daily", weekday: 1, label: "Monday" }, words: [
      { text: "Commander", x: 503, y: 557, width: 199, height: 28 },
      { text: "Points", x: 993, y: 553, width: 108, height: 33 },
      { text: "1", x: 132, y: 698, width: 54, height: 56 },
      { text: "Jordan Vale", x: 402, y: 672, width: 179, height: 34 },
      { text: "[QA] Synthetic", x: 404, y: 737, width: 334, height: 37 },
      { text: "23,340,000", x: 918, y: 707, width: 206, height: 27 },
      { text: "79", x: 119, y: 2183, width: 80, height: 42 },
      { text: "Morgan Reed", x: 405, y: 2152, width: 122, height: 28 },
      { text: "19,317,601", x: 880, y: 2187, width: 243, height: 33 },
      { text: "[QA] Synthetic", x: 404, y: 2219, width: 334, height: 37 },
    ] };
    expect(reviewRanking(input, members).rows.map(r => [r.sourceName,r.value,r.status])).toEqual([
      ["Jordan Vale",23340000,"exact"],["Morgan Reed",19317601,"exact"],
    ]);
  });
  it("keeps complete long names instead of matching a clipped prefix to another member", () => {
    const input: RankingRecognition = { text: "Ranking Commander Points", rankingContext: { kind: "daily", weekday: 1, label: "Monday" }, words: [
      { text: "Commander", x: 503, y: 557, width: 199, height: 28 },
      { text: "Points", x: 993, y: 553, width: 108, height: 33 },
      { text: "Jordan", x: 402, y: 672, width: 179, height: 34 },
      { text: "LongSurname", x: 590, y: 672, width: 240, height: 34 },
      { text: "23,340,000", x: 918, y: 707, width: 206, height: 27 },
    ] };
    expect(reviewRanking(input, [{id:"prefix",playerName:"Jordan",archived:false},{id:"whole",playerName:"Jordan LongSurname",archived:false}]).rows[0])
      .toMatchObject({sourceName:"Jordan LongSurname",memberId:"whole",status:"exact"});
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
  it("does not borrow a previous name when adjacent score and name text is missing", () => {
    const input = sample();
    input.words = input.words.map(w => w.y >= 320 ? { ...w, y: w.y - Math.floor((w.y - 320) / 100) * 45, height: w.x === 430 ? 30 : w.height } : w)
      .filter(w => w.text !== "23,340,000" && w.text !== "Morgan Reed");
    const row = reviewRanking(input, members).rows.find(r => r.value === 19317601);
    expect(row).toMatchObject({ sourceName: "", status: "invalid" });
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

it("proposes only new, alliance-labelled names and reconciles their scores by reporting window", () => {
  const base: BatchCandidate = { key: "0", source: 1, sourceName: "Riley Chen", sourceValue: "12", value: 12, status: "unmatched",
    memberId: null, matchedName: null, y: 1, allianceLabel: "[QA] Synthetic", window: "2026-11-16", attemptId: "first" };
  const second = { ...base, attemptId: "second" };
  expect(reconcileOverlap([base, second], true)).toMatchObject([{createMember:true, duplicates:1}]);
  expect(reconcileOverlap([base, {...second, value:13}], true)[0].conflict).toBe(true);
  expect(reconcileOverlap([base, {...second, sourceName:"Riley Chon"}],true).every(g => !g.createMember)).toBe(true);
  for (const row of [{...base,allianceLabel:null}, {...base,status:"archived" as const}, {...base,value:null}])
    expect(reconcileOverlap([row],true)[0].createMember).toBe(false);
  expect(reconcileOverlap([base])[0].createMember).toBe(false);
});
