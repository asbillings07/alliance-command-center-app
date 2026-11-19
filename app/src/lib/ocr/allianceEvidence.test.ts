import { describe, expect, it } from "vitest";
import { checkScreenshotAlliance } from "./allianceEvidence";
import { rankingFixture } from "./testing/rankingFixture";
import type { RankingRecognition } from "./ranking";

const expected = { name: "QA", server: "956" };
function ranking(labels = ["[QA] Synthetic", "[QA] Synthetic", "[QA] Synthetic"]): RankingRecognition {
  let i = 0;
  const original = rankingFixture().recognition;
  return { ...original, rankingContext: { kind: "daily", weekday: 1, label: "Monday" },
    words: original.words.flatMap(w => {
      if (!w.text.startsWith("[")) return [w];
      const text = labels[i++]; return text ? [{ ...w, text }] : [];
    }) };
}

describe("source alliance evidence", () => {
  it.each(["QA", "Synthetic", "[QA] Synthetic", "[QA]", "  synthetic  "])("matches an explicit tag or full name: %s", name => {
    expect(checkScreenshotAlliance(ranking(), { ...expected, name })).toBe("matched");
  });
  it("normalizes formatting and case without fuzzy matching", () => {
    expect(checkScreenshotAlliance(ranking(Array(3).fill("[ qa ]  SYNTHETIC ")), expected)).toBe("matched");
  });
  it.each(["Q", "[QA] Different", "QÁ", "QΑ", "Synthetic Other", "", "Synthetic!"])("rejects a nonmatching configured identity: %s", name => {
    expect(checkScreenshotAlliance(ranking(), { ...expected, name })).toBe("mismatch");
  });
  it("does not use recognized player names or the Your Alliance label as proof", () => {
    const source = ranking(Array(3).fill("[ELSE] Another Alliance"));
    source.words.push({ text: "Your Alliance", x: 180, y: 800, width: 200, height: 24 });
    expect(checkScreenshotAlliance(source, expected)).toBe("mismatch");
  });
  it("blocks mixed alliances even when a foreign score is unreadable", () => {
    const source = ranking(["[QA] Synthetic", "[ELSE] Another Alliance", "[QA] Synthetic"]);
    source.words = source.words.filter(w => w.text !== "19,317,601");
    expect(checkScreenshotAlliance(source, expected)).toBe("mixed");
  });
  it.each([["", "", ""], ["[QA] Synthetic", "", "[QA] Synthetic"], ["[QA]", "[QA]", "[QA]"]])("blocks incomplete row labels %j", (...labels) => {
    expect(checkScreenshotAlliance(ranking(labels), expected)).toBe("missing");
  });
  it("requires matching associated server evidence when present", () => {
    const source = ranking();
    source.words.push({ text: "#989 [QA]", x: 20, y: 10, width: 150, height: 14 });
    expect(checkScreenshotAlliance(source, expected)).toBe("server-mismatch");
    expect(checkScreenshotAlliance(source, { ...expected, server: "989" })).toBe("matched");
  });
  it("checks source alliance independently of the unresolved calendar context", () => {
    const source = ranking(); source.rankingContext = { kind: "missing", label: "Keep the selected tab visible" };
    expect(checkScreenshotAlliance(source, expected)).toBe("matched");
  });
  it("checks every Duel row and rejects mixed opponents", () => {
    const source: RankingRecognition = { text: "ALLIANCE DUEL\nToday's Duel\n[QA]Jordan Vale\n23,340,000\n[QA]Morgan Reed\n19,317,601",
      rankingContext: { kind: "today", label: "Today's Duel" }, words: [
        { text: "[QA]Jordan Vale", x: 100, y: 300, width: 200, height: 20 },
        { text: "23,340,000", x: 130, y: 340, width: 150, height: 20 },
        { text: "[QA]Morgan Reed", x: 100, y: 400, width: 200, height: 20 },
        { text: "19,317,601", x: 130, y: 440, width: 150, height: 20 },
      ] };
    expect(checkScreenshotAlliance(source, expected)).toBe("matched");
    source.words[2].text = "Morgan Reed";
    expect(checkScreenshotAlliance(source, expected)).toBe("missing");
    source.words[2].text = "[ELSE]Morgan Reed";
    expect(checkScreenshotAlliance(source, expected)).toBe("mixed");
  });
});
