import { matchEntriesToMembers, type RawEntry } from "../memberMatcher";
import { parseStrictInteger } from "../numberParser";
import { reviewDailyVs, type OcrWord, type Recognition } from "./recognition";

export type RankingContext =
  | { kind: "daily"; weekday: number; label: string }
  | { kind: "weekly"; label: "Weekly Rank" }
  | { kind: "today"; label: "Today's Duel" }
  | { kind: "missing"; label: string };
export type RankingRecognition = Recognition & { rankingContext?: RankingContext };
export type RosterMember = { id: string; playerName: string; archived: boolean };
export type RankingRow = { key: string; sourceName: string; sourceValue: string; value: number | null;
  memberId: string | null; matchedName: string | null; status: "exact" | "suggested" | "ambiguous" | "unmatched" | "invalid" | "archived";
  y: number; allianceLabel: string | null };
export type RankingReview = { context: RankingContext; countdown: string | null; rows: RankingRow[] };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const exactNameKey = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");

export function wordLines(words: OcrWord[]) {
  const lines: { words: OcrWord[]; y: number; height: number }[] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find(l => Math.abs(word.y + word.height / 2 - l.y - l.height / 2) < Math.min(word.height, l.height) * .5);
    if (line) line.words.push(word); else lines.push({ words: [word], y: word.y, height: word.height });
  }
  return lines.sort((a, b) => a.y - b.y).map(line => ({ ...line,
    text: line.words.sort((a, b) => a.x - b.x).map(w => w.text).join(" ") }));
}

function matchRow(sourceName: string, sourceValue: string, members: RosterMember[], index: number, y: number, allianceLabel: string | null): RankingRow {
  const parsed = parseStrictInteger(sourceValue);
  const value = parsed.success && parsed.value >= 0 ? parsed.value : null;
  const exact = members.filter(m => exactNameKey(m.playerName) === exactNameKey(sourceName));
  const raw: RawEntry = { name: sourceName, value: value ?? undefined, rawValue: sourceValue, sourceRow: index + 1 };
  // The shared import matcher supplies suggestions, never identity proof.
  const suggestion = sourceName && value !== null ? matchEntriesToMembers([raw], members).results[0] : null;
  const member = exact.length === 1 ? exact[0] : null;
  const status = !sourceName || value === null ? "invalid" : exact.length > 1 ? "ambiguous"
    : member ? member.archived ? "archived" : "exact" : suggestion?.memberId ? "suggested" : "unmatched";
  return { key: String(index), sourceName, sourceValue, value, status, y,
    memberId: member?.id ?? suggestion?.memberId ?? null,
    matchedName: member?.playerName ?? suggestion?.matchedName ?? null, allianceLabel };
}

export function reviewRanking(recognition: RankingRecognition, members: RosterMember[]): RankingReview {
  const context = recognition.rankingContext ?? { kind: "missing", label: "Keep the selected day or Weekly Rank visible" };
  const countdown = context.kind === "today" ? recognition.text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d:[0-5]\d\b/u)?.[0] ?? null : null;
  const result: RankingReview = { context, countdown, rows: [] };
  // Visible words alone cannot establish which of the displayed tabs is active.
  if (context.kind === "missing") return result;
  const lines = wordLines(recognition.words);
  if (context.kind === "today") {
    // One provider response supplies all rows. The existing conservative Duel
    // parser checks each visible name/score pair; no per-member scans occur.
    for (const line of lines.filter(l => /^\[[^\]\r\n]{1,16}\]/u.test(l.text)).slice(0, 150)) {
      const sourceName = line.text.replace(/^\[[^\]\r\n]{1,16}\]\s*/u, "").replace(/\s+You$/u, "");
      const review = reviewDailyVs(recognition, sourceName);
      result.rows.push(matchRow(sourceName, review.sourceScore ?? "", members, result.rows.length,
        line.y, line.text.match(/^\[[^\]]+\]/u)?.[0] ?? null));
    }
    return result;
  }
  const commander = recognition.words.find(w => /^commander$/iu.test(w.text));
  const points = recognition.words.find(w => /^points$/iu.test(w.text));
  if (!commander || !points || points.x <= commander.x || Math.abs(points.y - commander.y) > commander.height) return result;
  const nameLeft = commander.x - commander.width * .65;
  const scoreLeft = points.x - points.width * 1.6;
  const scores = wordLines(recognition.words.filter(w => w.x >= scoreLeft && w.y > points.y + points.height))
    .map(l => ({ ...l, values: l.words }))
    .filter(l => l.values.length && l.values.every(w => /^[\d.,]+$/u.test(w.text)));
  for (let i = 0; i < scores.length && result.rows.length < 150; i++) {
    const score = scores[i];
    const yMin = Math.max(points.y + points.height * 2, score.y - score.height * 1.5,
      i ? (scores[i - 1].y + score.y) / 2 : 0);
    const yMax = Math.min(score.y + score.height * .6, i + 1 < scores.length ? (score.y + scores[i + 1].y) / 2 : Infinity);
    const nearby = wordLines(recognition.words.filter(w => w.x >= nameLeft && !score.values.includes(w)
      && w.y >= yMin && w.y <= yMax));
    const names = nearby.filter(l => !/^\[/u.test(l.text) && !/^\d+$/u.test(l.text));
    const sourceName = names.length === 1 ? names[0].text : "";
    const sourceValue = score.values.map(w => w.text).join("");
    const alliance = wordLines(recognition.words.filter(w => w.x >= nameLeft && !score.values.includes(w)))
      .find(l => l.y > (names[0]?.y ?? score.y) && l.y <= score.y + score.height * 2 && /^\[/u.test(l.text))?.text ?? null;
    result.rows.push(matchRow(sourceName, sourceValue, members, i, names[0]?.y ?? score.y, alliance));
  }
  return result;
}

/** A weekday identifies a slot within a chosen week, never a calendar date by itself. */
export function rankingWindow(context: RankingContext, weekStart: string, captureDate = "") {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/u.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (context.kind === "today") return valid(captureDate) ? captureDate : null;
  if (!valid(weekStart) || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) return null;
  if (context.kind === "weekly") return `week:${weekStart}`;
  if (context.kind !== "daily") return null;
  const day = new Date(`${weekStart}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + (context.weekday + 6) % 7);
  return day.toISOString().slice(0, 10);
}

/** MetricPeriod boundaries are inclusive civil dates. */
export function isRankingWeekPeriod(monday: string, start?: string, end?: string) {
  if (start !== monday || !end || rankingWindow({ kind: "weekly", label: "Weekly Rank" }, monday) === null) return false;
  return [5, 6].includes((Date.parse(end) - Date.parse(monday)) / 86400000);
}

export function showCurrentDayProgress(review: RankingReview, confirmedDate: string | null, now = new Date()) {
  // Owner-confirmed fixed reset: 01:00 UTC (9 PM EDT, 8 PM EST). No finality inference.
  const gameDay = new Date(now.getTime() - 60 * 60 * 1000).toISOString().slice(0, 10);
  return review.context.kind === "today" && !!review.countdown && review.countdown.split(":").some(part => Number(part) > 0) && confirmedDate === gameDay;
}

export type BatchCandidate = RankingRow & { attemptId: string; window: string | null; source: number };
export function reconcileOverlap(rows: BatchCandidate[], allowNewMembers = false) {
  const possible = (r: BatchCandidate) => r.status === "unmatched" && !!r.allianceLabel && r.value !== null
    && r.sourceName.trim().length > 0 && r.sourceName.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(r.sourceName);
  const newNames = new Set(allowNewMembers ? rows.filter(possible).map(r => exactNameKey(r.sourceName)) : []);
  // Different spellings in the same capture may represent one person. Hold both.
  const uncertain = new Set<string>();
  const spellings = new Map<string, string>();
  for (const name of newNames) {
    // Compare variation keys in linear passes, including single OCR omissions,
    // substitutions and transpositions. Preserve the original display name.
    const folded = name.normalize("NFKC").toLowerCase();
    const variants = new Set([folded]);
    for (let i = 0; i < folded.length; i++) variants.add(folded.slice(0, i) + folded.slice(i + 1));
    for (const variant of variants) {
      const other = spellings.get(variant);
      if (other !== undefined && other !== name) { uncertain.add(name); uncertain.add(other); }
      else spellings.set(variant, name);
    }
  }
  const safeNames = new Set([...newNames].filter(name => !uncertain.has(name)));
  const groups = new Map<string, BatchCandidate[]>();
  for (const row of rows) {
    // Daily and weekly slots stay separate. Unknown source identities never merge.
    const createMember = possible(row) && safeNames.has(exactNameKey(row.sourceName));
    const key = row.window && (row.status === "exact" || createMember)
      ? JSON.stringify([createMember ? "new" : "existing", createMember ? exactNameKey(row.sourceName) : row.memberId, row.window])
      : JSON.stringify(["source", row.attemptId, row.key]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(group => ({ row: group[0], sources: group, createMember: possible(group[0]) && safeNames.has(exactNameKey(group[0].sourceName)),
    conflict: group.some(r => r.value !== group[0].value), duplicates: group.length - 1 }));
}
