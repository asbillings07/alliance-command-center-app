import "server-only";
import { createHash } from "node:crypto";
import { localOcrFixtureEnabled } from "../config";
import { rankingFixture } from "./rankingFixture";
import type { OcrTransport } from "../provider";

// Explicit localhost/CI fixture, unavailable in every Vercel environment.
// This is never evidence that Google's recognition or storage worked.
const state = globalThis as typeof globalThis & { ocrFixtureObjects?: Map<string, Uint8Array>; ocrFixtureFailures?: Set<string> };
export function syntheticOcrTransport(): OcrTransport {
  if (!localOcrFixtureEnabled()) throw new Error("Synthetic OCR transport is local-only");
  const objects = state.ocrFixtureObjects ??= new Map();
  return {
    async preflight() {},
    async put(name, bytes) { if (objects.has(name)) throw new Error("Duplicate object"); objects.set(name, Uint8Array.from(bytes)); },
    async read(name, limit) { const bytes = objects.get(name); if (!bytes || bytes.length > limit) throw new Error("Missing fixture"); return bytes; },
    async recognize(image) { if (image.width === 601 && image.height === 900) {
      const digest = createHash("sha256").update(image.bytes).digest("hex");
      const failures = state.ocrFixtureFailures ??= new Set();
      if (!failures.has(digest)) {failures.add(digest); throw new Error("Synthetic interrupted recognition");}
    }
    if ((image.width === 600 || image.width === 601) && image.height === 900) return rankingFixture().recognition; return {
      text: "ALLIANCE DUEL\nToday's Duel\nTrain Heroes\n23:39:25\n[TEST]Jordan Vale\n23,340,000\n[OTHER]Morgan Reed\n19,317,601",
      words: [
        { text: "[TEST]Jordan", x: 150, y: 350, width: 140, height: 26 }, { text: "Vale", x: 300, y: 350, width: 60, height: 26 },
        { text: "23,340,000", x: 220, y: 395, width: 180, height: 26 },
        { text: "[OTHER]Morgan", x: 150, y: 460, width: 180, height: 26 }, { text: "Reed", x: 340, y: 460, width: 65, height: 26 },
        { text: "19,317,601", x: 220, y: 505, width: 180, height: 26 },
      ],
    }; },
  };
}
