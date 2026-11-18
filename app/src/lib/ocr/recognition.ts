export type OcrWord = { text: string; x: number; y: number; width: number; height: number };
export type Recognition = { text: string; words: OcrWord[] };
export type VsReview = {
  identity: "candidate" | "missing" | "ambiguous";
  score: number | null;
  sourceName: string | null;
  sourceScore: string | null;
  progress: "in-progress" | "unknown";
  countdown: string | null;
  supportedScreen: boolean;
};

const nameKey = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
// Only the explicit bracketed alliance tag is removed. Never strip accents,
// change case, remove punctuation, or accept a fuzzy/confusable name match.
function playerName(value: string) {
  return nameKey(value.replace(/^\[[^\]\r\n]{1,16}\]\s*/u, ""));
}

export function reviewDailyVs(recognition: Recognition, expectedName: string): VsReview {
  const lines: { words: OcrWord[]; y: number; height: number }[] = [];
  for (const word of [...recognition.words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find(l => Math.abs((word.y + word.height / 2) - (l.y + l.height / 2)) < Math.min(word.height, l.height) * 0.5);
    if (line) line.words.push(word);
    else lines.push({ words: [word], y: word.y, height: word.height });
  }
  const ordered = lines.sort((a, b) => a.y - b.y).map(line => ({ ...line,
    text: line.words.sort((a, b) => a.x - b.x).map(w => w.text).join(" "),
  }));
  const countdown = recognition.text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d:[0-5]\d\b/u)?.[0] ?? null;
  const supportedScreen = /ALLIANCE\s+DUEL/iu.test(recognition.text) && /Today[’']s\s+Duel/iu.test(recognition.text);
  const expected = nameKey(expectedName);
  // The complete name line must match; a substring elsewhere never counts.
  const matches = ordered.filter(line => playerName(line.text.replace(/\s+You$/u, "")) === expected);
  const result: VsReview = { identity: matches.length === 1 ? "candidate" : matches.length > 1 ? "ambiguous" : "missing",
    score: null, sourceName: matches.length === 1 ? matches[0].text : null, sourceScore: null,
    progress: countdown ? "in-progress" : "unknown", countdown, supportedScreen };
  if (matches.length !== 1 || !supportedScreen) return result;
  const name = matches[0];
  const startX = Math.min(...name.words.map(w => w.x));
  const endX = Math.max(...name.words.map(w => w.x + w.width));
  // A deliberately narrow, unqualified candidate rule: the next line below
  // this name, within three name-heights and horizontally under the name.
  const below = ordered.find(l => l.y > name.y + name.height * 0.75);
  if (!below || below.y - name.y > name.height * 3) return result;
  const numeric = /^(?:\d{1,3}(?:,\d{3})+|\d{1,12})$/u;
  // A later player can have their name and value on one line. Any nonnumeric
  // content on this line leaves the association unresolved, even if one number
  // happens to align with the previous name. Never borrow across columns.
  if (below.words.some(w => !numeric.test(w.text))) return result;
  const scores = below.words.filter(w => w.x >= startX - name.height
    && w.x <= endX + name.height * 3 && w.height >= name.height * 0.55);
  if (scores.length !== 1) return result;
  const score = Number(scores[0].text.replaceAll(",", ""));
  if (Number.isSafeInteger(score) && score >= 0) { result.score = score; result.sourceScore = scores[0].text; }
  return result;
}

export function parseVisionResponse(value: unknown, width: number, height: number): Recognition {
  const root = value as { responses?: { error?: unknown; textAnnotations?: {
    description?: unknown; boundingPoly?: { vertices?: { x?: number; y?: number }[] }
  }[] }[] };
  if (!root || !Array.isArray(root.responses) || root.responses.length !== 1 || root.responses[0].error) throw new Error("Invalid recognition response");
  const annotations = root.responses[0].textAnnotations ?? [];
  if (!Array.isArray(annotations) || annotations.length > 1001) throw new Error("Recognition response is too large");
  const text = annotations[0]?.description ?? "";
  if (typeof text !== "string" || text.length > 16000) throw new Error("Invalid recognition text");
  const words: OcrWord[] = [];
  for (const annotation of annotations.slice(1)) {
    if (typeof annotation.description !== "string" || annotation.description.length > 500) throw new Error("Invalid recognition word");
    const vertices = annotation.boundingPoly?.vertices;
    if (!Array.isArray(vertices) || vertices.length !== 4) continue;
    if (vertices.some(v => !Number.isFinite(v.x ?? 0) || !Number.isFinite(v.y ?? 0)
      || (v.x ?? 0) < 0 || (v.y ?? 0) < 0 || (v.x ?? 0) > width || (v.y ?? 0) > height)) continue;
    const x = Math.min(...vertices.map(v => v.x ?? 0)); const y = Math.min(...vertices.map(v => v.y ?? 0));
    const w = Math.max(...vertices.map(v => v.x ?? 0)) - x; const h = Math.max(...vertices.map(v => v.y ?? 0)) - y;
    if (w > 0 && h > 0) words.push({ text: annotation.description, x, y, width: w, height: h });
  }
  return { text, words };
}
