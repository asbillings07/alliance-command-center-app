import { describe, it, expect } from "vitest";
import { parseVisionResponse, reviewDailyVs, type Recognition } from "./recognition";

const example = (name = "[WoRD]Mándo"): Recognition => ({
  text: `ALLIANCE DUEL\nToday's Duel\nTrain Heroes\n23:39:25\n${name}\n23,340,000`,
  words: [{ text: name, x: 150, y: 350, width: 200, height: 26 },
    { text: "23,340,000", x: 220, y: 395, width: 180, height: 26 }],
});
describe("daily VS recognition candidates", () => {
  it("pairs the exact member name with its nearby score and preserves progress", () => {
    expect(reviewDailyVs(example(), "Mándo")).toMatchObject({ identity: "candidate", score: 23340000, progress: "in-progress", countdown: "23:39:25" });
  });
  it.each(["Mando", "mándo", "Mándо", "Other Mándo", "Mándo Other"])("does not accept changed or confusable identity %s", name => {
    expect(reviewDailyVs(example(), name)).toMatchObject({ identity: "missing", score: null });
  });
  it("supports Unicode canonical equivalence without removing accents", () => {
    expect(reviewDailyVs(example("[WoRD]Ma\u0301ndo"), "Mándo").identity).toBe("candidate");
    expect(reviewDailyVs(example("[WoRD]지돌"), "지돌").identity).toBe("candidate");
  });
  it("does not borrow a later player's score", () => {
    const input = example(); input.words.splice(1, 0, { text: "[Other]Player", x: 150, y: 380, width: 200, height: 26 });
    expect(reviewDailyVs(input, "Mándo").score).toBeNull();
  });
  it("rejects a later line that contains another player's name and score together", () => {
    const input = example(); input.words.push({ text: "Other Player", x: 150, y: 395, width: 170, height: 26 });
    expect(reviewDailyVs(input, "Mándo").score).toBeNull();
  });
  it("does not borrow a number from an unrelated horizontal column", () => {
    const input = example(); input.words[1].x = 800;
    expect(reviewDailyVs(input, "Mándo").score).toBeNull();
  });
  it("blocks duplicate matching rows and multiple nearby numbers", () => {
    const duplicate = example(); duplicate.words.push({ ...duplicate.words[0], y: 500 });
    expect(reviewDailyVs(duplicate, "Mándo").identity).toBe("ambiguous");
    const values = example(); values.words.push({ text: "44827", x: 420, y: 395, width: 100, height: 26 });
    expect(reviewDailyVs(values, "Mándo").score).toBeNull();
  });
  it("does not infer finality or a date from a missing countdown", () => {
    const input = example(); input.text = input.text.replace("23:39:25", "");
    expect(reviewDailyVs(input, "Mándo")).toMatchObject({ progress: "unknown", countdown: null });
  });
  it("does not assign a score from a different or unsupported screen", () => {
    const input = example(); input.text = "Weekly Scores";
    expect(reviewDailyVs(input, "Mándo")).toMatchObject({ score: null, supportedScreen: false });
  });
  it.each(["23,34,000", "23.34M", "-1", "23,340,000.5"])("does not guess a numeric reading %s", value => {
    const input = example(); input.words[1].text = value;
    expect(reviewDailyVs(input, "Mándo").score).toBeNull();
  });
});

describe("bounded Vision response", () => {
  it("reads valid word boxes, including omitted zero coordinates", () => {
    expect(parseVisionResponse({ responses: [{ textAnnotations: [{ description: "Name" }, { description: "Name", boundingPoly: { vertices: [{}, { x: 50 }, { x: 50, y: 20 }, { y: 20 }] } }] }] }, 200, 200))
      .toEqual({ text: "Name", words: [{ text: "Name", x: 0, y: 0, width: 50, height: 20 }] });
  });
  it("preserves no-text output without inventing confidence or values", () => {
    expect(parseVisionResponse({ responses: [{}] }, 200, 200)).toEqual({ text: "", words: [] });
  });
  it.each([null, {}, { responses: [{ error: { message: "private provider text" } }] }, { responses: [{ textAnnotations: [{ description: "a".repeat(16001) }] }] }])("rejects malformed, failed or excessive responses", input => {
    expect(() => parseVisionResponse(input, 200, 200)).toThrow();
  });
});
