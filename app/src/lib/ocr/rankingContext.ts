import "server-only";
import sharp from "sharp";
import type { Recognition, OcrWord } from "./recognition";
import { WEEKDAYS, type RankingContext } from "./ranking";

/** Qualify the highlighted source tab, not merely the presence of both labels. */
export async function readRankingContext(bytes: Uint8Array, recognition: Recognition): Promise<RankingContext> {
  const missing: RankingContext = { kind: "missing", label: "Keep the selected day or Weekly Rank visible" };
  if (/ALLIANCE\s+DUEL/iu.test(recognition.text) && /Today[’']s\s+Duel/iu.test(recognition.text)) {
    return { kind: "today", label: "Today's Duel" };
  }
  if (!/ranking/iu.test(recognition.text) || !/commander/iu.test(recognition.text) || !/points/iu.test(recognition.text)) return missing;
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  function fraction(word: OcrWord, color: "orange" | "white") {
    const x0 = Math.max(0, Math.floor(word.x - word.height * .5));
    const x1 = Math.min(info.width, Math.ceil(word.x + word.width + word.height * .5));
    const y0 = Math.max(0, Math.floor(word.y - word.height * .5));
    const y1 = Math.min(info.height, Math.ceil(word.y + word.height * 1.5));
    let count = 0, total = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const p = (y * info.width + x) * info.channels; const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
      total++;
      if (color === "orange" ? r > 210 && g > 75 && g < 205 && b < 80 : Math.min(r, g, b) > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 30) count++;
    }
    return total ? count / total : 0;
  }
  const daily = recognition.words.filter(w => /^daily$/iu.test(w.text));
  const weekly = recognition.words.filter(w => /^weekly$/iu.test(w.text));
  const selectedDaily = daily.filter(w => fraction(w, "orange") > .3);
  const selectedWeekly = weekly.filter(w => fraction(w, "orange") > .3);
  if (selectedWeekly.length === 1 && selectedDaily.length === 0) return { kind: "weekly", label: "Weekly Rank" };
  if (selectedDaily.length !== 1 || selectedWeekly.length) return missing;
  const tab = selectedDaily[0];
  const weekdays = recognition.words.flatMap(w => {
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex(d => w.text.toLowerCase().startsWith(d));
    return day >= 0 && /^(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\.?$/iu.test(w.text)
      && w.y > tab.y + tab.height && w.y < tab.y + tab.height * 7 && fraction(w, "white") > .45 ? [day] : [];
  });
  if (weekdays.length !== 1) return missing;
  return { kind: "daily", weekday: weekdays[0], label: WEEKDAYS[weekdays[0]] };
}
