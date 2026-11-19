import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireQaAllianceEditing, validateQaAllianceName } from "./qaAlliance";
vi.mock("../prisma", () => ({ prisma: {} }));
const connection = (id: string) => `postgresql://test:private-password@${id}.us-east-1.aws.neon.tech/neondb`;
const qa = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "acc-ocr-eval", VERCEL_GIT_COMMIT_REF: "codex/ocr-recognition-trial",
  OCR_EVAL_ENABLED: "true", OCR_EVAL_ALLIANCE_IDS: "qa-alliance", PRODUCTION_DB_HOSTS: "ep-production-123",
  OCR_EVAL_SHARED_DB_HOSTS: "ep-preview-456", OCR_EVAL_DB_IDENTITY: "ep-ocr-789",
  DATABASE_URL: connection("ep-ocr-789-pooler"), DIRECT_URL: connection("ep-ocr-789"),
  SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_REPLAY: "false",
};
beforeEach(() => { for (const [key, value] of Object.entries(qa)) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());
describe("isolated QA name editing", () => {
  it("allows only the dedicated QA stack and allowlisted alliance", () => {
    expect(() => requireQaAllianceEditing("qa-alliance")).not.toThrow();
    expect(() => requireQaAllianceEditing("other-alliance")).toThrow("not enabled for this alliance");
  });
  it.each([
    ["VERCEL_ENV", "production"], ["VERCEL_TARGET_ENV", "preview"], ["VERCEL_GIT_COMMIT_REF", "main"],
    ["OCR_EVAL_ENABLED", "false"], ["DATABASE_URL", connection("ep-production-123")],
    ["DIRECT_URL", connection("ep-preview-456")], ["OCR_EVAL_DB_IDENTITY", ""],
    ["DATABASE_URL", connection("ep-ocr-789") + "?host=live.example"],
  ])("blocks invalid %s before opening a database", (key, value) => {
    vi.stubEnv(key, value); expect(() => requireQaAllianceEditing("qa-alliance")).toThrow();
  });
  it("limits the synthetic override to a loopback database outside Vercel", () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("ACC_E2E_MODE", "1"); vi.stubEnv("OCR_EVAL_TEST_FIXTURE", "1");
    expect(() => requireQaAllianceEditing("qa-alliance")).toThrow("isolated test database");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@127.0.0.1/test"); expect(() => requireQaAllianceEditing("qa-alliance")).not.toThrow();
  });
  it("preserves the entered tag/name while rejecting blank, multiline and excessive values", () => {
    expect(validateQaAllianceName("  [QA] Test alliance  ")).toBe("[QA] Test alliance");
    for (const name of [" ", "x".repeat(201), "A\nB", "A\u0000B"]) expect(() => validateQaAllianceName(name)).toThrow("one line");
  });
});
