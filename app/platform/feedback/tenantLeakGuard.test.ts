import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const SCANNED_ROOTS = [
  resolve(REPO_ROOT, "app/feedback"),
  resolve(REPO_ROOT, "app/alliances"),
];

const FORBIDDEN_IMPORTS = [
  "@/app/src/lib/platform/feedbackInbox",
  "../src/lib/platform/feedbackInbox",
  "../../src/lib/platform/feedbackInbox",
  "../../../src/lib/platform/feedbackInbox",
  "@/app/src/lib/feedbackTriage",
  "../src/lib/feedbackTriage",
  "../../src/lib/feedbackTriage",
  "../../../src/lib/feedbackTriage",
];

const FORBIDDEN_IDENTIFIERS = [
  "feedbackInbox",
  "feedbackTriage",
  "FeedbackTriageEvent",
  "FeedbackTriage",
  "prisma.feedbackTriage",
  "prisma.feedbackTriageEvent",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    const ext = fullPath.slice(fullPath.lastIndexOf("."));
    if (SOURCE_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("platform feedback inbox tenant leak guardrails", () => {
  for (const root of SCANNED_ROOTS) {
    const files = collectSourceFiles(root);

    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file);
      const source = readFileSync(file, "utf8");

      it(`${relativePath} does not import platform feedback inbox modules`, () => {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(source).not.toContain(forbidden);
        }
      });

      it(`${relativePath} does not reference feedback triage Prisma models directly`, () => {
        for (const identifier of FORBIDDEN_IDENTIFIERS) {
          expect(source).not.toContain(identifier);
        }
      });
    }
  }
});
