import { reviewRanking, wordLines, type RankingRecognition } from "./ranking";
import { reviewDailyVs } from "./recognition";

export type AllianceEvidence = "matched" | "missing" | "mismatch" | "mixed" | "server-mismatch";
type AllianceLabel = { tag: string; name: string; server: string | null };
// Formatting/case only. Never fuzzy-match, strip accents or discard punctuation.
const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const serverKey = (value: string) => value.trim().replace(/^#/u, "");
function label(value: string): AllianceLabel | null {
  const match = value.match(/^(?:#(\d+)\s*)?\[\s*([^\]\r\n]{1,16}?)\s*\]\s*([^\[\]\r\n]*)$/u);
  return match ? { server: match[1] ?? null, tag: key(match[2]), name: key(match[3]) } : null;
}

/** Source evidence is independent of roster names and of editable review fields. */
export function checkScreenshotAlliance(recognition: RankingRecognition, expected: { name: string; server: string }): AllianceEvidence {
  const lines = wordLines(recognition.words);
  const today = recognition.rankingContext?.kind === "today";
  const points = recognition.words.find(w => /^points$/iu.test(w.text));
  if (!today && (!points || !recognition.words.some(w => /^commander$/iu.test(w.text)))) return "missing";
  const rows = reviewRanking(recognition, []).rows;
  if (rows.some(row => !row.allianceLabel)) return "missing";
  // The tagged-row parser must not silently hide a player whose tag was cropped
  // out or missed by OCR. Check recognizable untagged name/score pairs too.
  if (today && lines.some(line => !/^\[/u.test(line.text)
    && reviewDailyVs(recognition, line.text.replace(/\s+You$/u, "")).score !== null)) return "missing";
  // Inspect every visible ranking alliance line, including rows whose score was
  // unreadable. A correct name elsewhere cannot launder another alliance's data.
  const values = today ? rows.map(row => row.allianceLabel!) : lines.filter(line => line.y > points!.y && /^(?:#\d+\s*)?\[/u.test(line.text)).map(line => line.text);
  if (!values.length) return "missing";
  const labels = values.map(label);
  if (labels.some(value => !value?.tag || (!today && !value.name))) return "missing";
  const known = labels as AllianceLabel[];
  if (new Set(known.map(value => JSON.stringify([value.tag, value.name]))).size !== 1) return "mixed";
  const configured = label(expected.name);
  const plain = key(expected.name);
  const matches = known.every(value => configured
    ? value.tag === configured.tag && (!configured.name || !value.name || value.name === configured.name)
    : value.tag === plain || value.name === plain);
  if (!plain || !matches) return "mismatch";
  // Compare reliably associated server evidence when the supported source shows
  // it. Ranking screens without a server number do not establish server identity.
  const headers = lines.map(line => label(line.text)).filter((value): value is AllianceLabel => !!value?.server && value.tag === known[0].tag);
  if ([...known, ...headers].some(value => value.server && serverKey(value.server) !== serverKey(expected.server))) return "server-mismatch";
  return "matched";
}

export function allianceRejectionMessage(outcome: string | null | undefined) {
  if (outcome === "alliance-missing") return "The screenshot's alliance could not be verified. Use a clearer, uncropped ranking screenshot with the alliance tag or name visible for every row. No results were added.";
  if (outcome === "alliance-mixed") return "This screenshot contains more than one alliance. In the game, select Your Alliance and capture the rankings again. No results were added.";
  if (outcome === "alliance-server-mismatch") return "The screenshot shows a different server from this alliance's record. Check the alliance and server before choosing another screenshot. No results were added.";
  return "This screenshot does not match the alliance you are capturing results for. Choose a screenshot from this alliance. No results were added.";
}

export function isAllianceRejection(attempt: { outcome?: string | null }) {
  return ["alliance-missing", "alliance-mixed", "alliance-mismatch", "alliance-server-mismatch"].includes(attempt.outcome ?? "");
}
