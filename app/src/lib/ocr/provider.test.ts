import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedBody, googleOcrTransport, validateBucketPolicy } from "./provider";
import { googleOcrConfig, localOcrFixtureEnabled, ocrEvaluationVisible, requireOcrEvaluation } from "./config";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: async () => "synthetic-token" }));
vi.mock("google-auth-library", () => ({ IdentityPoolClient: class { async getAccessToken() { return { token: "synthetic-token" }; } } }));
const bucket = () => ({ location: "US", storageClass: "STANDARD", iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } },
  softDeletePolicy: { retentionDurationSeconds: "0" }, lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 30 } }] } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function config() {
  vi.stubEnv("VERCEL_TARGET_ENV", "acc-ocr-eval");
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/ocr-recognition-trial");
  vi.stubEnv("OCR_EVAL_ENABLED", "true"); vi.stubEnv("OCR_EVAL_ALLIANCE_IDS", "qa-alliance");
  vi.stubEnv("OCR_GCP_PROJECT", "orion-os-503204"); vi.stubEnv("OCR_GCP_PROJECT_NUMBER", "381354446256");
  vi.stubEnv("OCR_GCP_SERVICE_ACCOUNT", "acc-ocr-eval@orion-os-503204.iam.gserviceaccount.com"); vi.stubEnv("OCR_GCS_BUCKET", "acc-ocr-eval-test");
}
describe("OCR environment isolation", () => {
  it("fails closed until explicitly enabled for the reviewed branch and alliance", () => {
    expect(ocrEvaluationVisible()).toBe(false); config(); expect(ocrEvaluationVisible()).toBe(true);
    expect(() => requireOcrEvaluation("other")).toThrow("not enabled"); expect(() => requireOcrEvaluation("qa-alliance")).not.toThrow();
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "other"); expect(ocrEvaluationVisible()).toBe(false);
  });
  it.each(["production", "development"])("cannot enable in hosted %s", environment => {
    config(); vi.stubEnv("VERCEL_ENV", environment); vi.stubEnv("OCR_EVAL_TEST_FIXTURE", "1"); vi.stubEnv("ACC_E2E_MODE", "1");
    expect(ocrEvaluationVisible()).toBe(false); expect(localOcrFixtureEnabled()).toBe(false); expect(() => googleOcrConfig()).toThrow();
  });
  it("requires preview telemetry exclusion before accepting private images", () => {
    config(); vi.stubEnv("SENTRY_DSN", "synthetic-dsn"); expect(() => requireOcrEvaluation("qa-alliance")).toThrow("privacy");
  });
  it("denies ordinary previews even if their branch and enabled flag match", () => {
    config(); vi.stubEnv("VERCEL_TARGET_ENV", "preview");
    expect(ocrEvaluationVisible()).toBe(false); expect(() => googleOcrConfig()).toThrow();
  });
});
describe("storage retention preflight", () => {
  it("accepts private US standard storage with only a 30-day deletion rule", () => expect(() => validateBucketPolicy(bucket())).not.toThrow());
  it.each([
    { versioning: { enabled: true } }, { softDeletePolicy: { retentionDurationSeconds: "604800" } },
    { retentionPolicy: { retentionPeriod: "8640000" } }, { defaultEventBasedHold: true },
    { iamConfiguration: { publicAccessPrevention: "inherited" } }, { location: "EU" },
    { lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 31 } }] } },
  ])("rejects a storage policy that cannot meet the privacy agreement", change => expect(() => validateBucketPolicy({ ...bucket(), ...change })).toThrow());
});
describe("bounded provider execution", () => {
  it("stops reading an oversized streamed body", async () => {
    await expect(boundedBody(new Response("a".repeat(40)), 20)).rejects.toThrow("too large");
  });
  it("sends one image and one text feature to the US endpoint with no retry", async () => {
    config(); const send = vi.fn().mockResolvedValue(new Response("provider error including private content", { status: 503 })); vi.stubGlobal("fetch", send);
    await expect(googleOcrTransport().recognize({ bytes: new Uint8Array([1, 2]), width: 200, height: 200 })).rejects.toThrow("Recognition unavailable");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("https://us-vision.googleapis.com/v1/projects/orion-os-503204/locations/us/images:annotate");
    expect(JSON.parse(send.mock.calls[0][1].body).requests).toEqual([{ image: { content: "AQI=" }, features: [{ type: "TEXT_DETECTION" }] }]);
  });
});
