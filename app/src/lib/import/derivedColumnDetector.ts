export type DerivedReason = "percentage" | "rank" | "delta" | "aggregate_range";

export type DerivedColumnAnalysis = {
  isDerived: boolean;
  reason: DerivedReason | null;
  explanation: string | null;
};

const PERCENTAGE_KEYWORDS = ["%", "percent", "pct", "rate", "ratio"];
const RANK_KEYWORDS = ["rank", "#", "position", "pos", "place"];
const DELTA_KEYWORDS = ["delta", "change", "diff", "difference", "growth", "wow", "mom", "vs last", "vs prior"];

export function analyzeDerivedColumn(headerText: string): DerivedColumnAnalysis {
  const normalized = headerText.trim().toLowerCase();

  if (!normalized) {
    return { isDerived: false, reason: null, explanation: null };
  }

  // 1. Percentage check
  for (const kw of PERCENTAGE_KEYWORDS) {
    if (normalized.includes(kw)) {
      return {
        isDerived: true,
        reason: "percentage",
        explanation: `Header contains percentage indicator "${kw}"`,
      };
    }
  }

  // 2. Rank check
  for (const kw of RANK_KEYWORDS) {
    if (normalized.startsWith(kw) || normalized.endsWith(kw) || new RegExp(`\\b${kw}\\b`, "i").test(normalized)) {
      return {
        isDerived: true,
        reason: "rank",
        explanation: `Header indicates leaderboard rank/position ("${kw}")`,
      };
    }
  }

  // 3. Delta/Change check
  for (const kw of DELTA_KEYWORDS) {
    if (normalized.includes(kw)) {
      return {
        isDerived: true,
        reason: "delta",
        explanation: `Header indicates relative metric change or delta ("${kw}")`,
      };
    }
  }

  // 4. Aggregate Range check
  if (/\b(total|sum|cumulative|aggregate)\b/i.test(normalized) && /\b(from|between|to|through)\b/i.test(normalized)) {
    return {
      isDerived: true,
      reason: "aggregate_range",
      explanation: "Header represents an aggregate total across a range of periods",
    };
  }

  return { isDerived: false, reason: null, explanation: null };
}
