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
  vi.stubEnv("OCR_GCP_PROJECT", "project-106f8c4e-a31b-4e3c-bc5"); vi.stubEnv("OCR_GCP_PROJECT_NUMBER", "735932937321");
  vi.stubEnv("OCR_GCP_SERVICE_ACCOUNT", "acc-ocr-eval@project-106f8c4e-a31b-4e3c-bc5.iam.gserviceaccount.com"); vi.stubEnv("OCR_GCS_BUCKET", "acc-ocr-eval-test");
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
  it.each([
    ["OCR_GCP_PROJECT", "orion-os-503204"],
    ["OCR_GCP_PROJECT_NUMBER", "381354446256"],
    ["OCR_GCP_SERVICE_ACCOUNT", "acc-ocr-eval@orion-os-503204.iam.gserviceaccount.com"],
  ])("rejects a stale %s before provider dispatch", (key, value) => {
    config(); vi.stubEnv(key, value);
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    expect(() => googleOcrTransport()).toThrow("No scan was sent");
    expect(send).not.toHaveBeenCalled();
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
const retryInfo = (retryDelay: string) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay });
const perImageDelay = (delay: string) => Response.json({ responses: [{ error: { code: 14, details: [retryInfo(delay)] } }] });

describe("bounded provider execution", () => {
  it("stops reading an oversized streamed body", async () => {
    await expect(boundedBody(new Response("a".repeat(40)), 20)).rejects.toThrow("too large");
  });
  it("sends one image and one text feature to the US endpoint with no retry", async () => {
    config(); const send = vi.fn().mockResolvedValue(new Response("provider error including private content", { status: 503 })); vi.stubGlobal("fetch", send);
    await expect(googleOcrTransport().recognize({ bytes: new Uint8Array([1, 2]), width: 200, height: 200 })).rejects.toMatchObject({ reason: "provider-temporary", message: "Google’s text recognition service is temporarily unavailable." });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("https://us-vision.googleapis.com/v1/projects/project-106f8c4e-a31b-4e3c-bc5/locations/us/images:annotate");
    expect(JSON.parse(send.mock.calls[0][1].body).requests).toEqual([{ image: { content: "AQI=" }, features: [{ type: "TEXT_DETECTION" }] }]);
  });
  it.each([
    ["error inside a successful HTTP response", () => Response.json({ responses: [{ error: { message: "private-sentinel" } }] }), "provider-error"],
    ["per-image UNAVAILABLE", () => Response.json({ responses: [{ error: { code: 14 } }] }), "provider-temporary"],
    ["HTTP backoff with per-image UNAVAILABLE", () => Response.json({ responses: [{ error: { code: 14 } }] }, { headers: { "Retry-After": "60" } }), "provider-error"],
    ["short per-image backoff", () => perImageDelay("1.500s"), "provider-temporary"],
    ["long per-image backoff", () => perImageDelay("2.001s"), "provider-error"],
    ["malformed per-image backoff", () => perImageDelay("later"), "provider-error"],
    ["structured HTTP 503 backoff", () => Response.json({ error: { details: [retryInfo("12s")] } }, { status: 503 }), "provider-error"],
    ["long backoff requested", () => new Response(null, { status: 503, headers: { "Retry-After": "60" } }), "provider-error"],
    ["quota refusal", () => new Response(null, { status: 429 }), "provider-error"],
    ["network interruption", () => { throw new Error("private-sentinel"); }, "provider-unavailable"],
    ["invalid JSON", () => new Response("private-sentinel"), "response-unreadable"],
    ["invalid structure", () => Response.json({ private: "private-sentinel" }), "response-unreadable"],
    ["oversized response", () => new Response("x".repeat(512 * 1024 + 1)), "result-too-large"],
  ] as const)("classifies %s without exposing raw details or retrying", async (_example, makeResponse, reason) => {
    config();
    const send = vi.fn(makeResponse);
    vi.stubGlobal("fetch", send);
    const result = googleOcrTransport().recognize({ bytes: new Uint8Array([1]), width: 200, height: 200 });
    await expect(result).rejects.toMatchObject({ reason });
    await expect(result).rejects.not.toThrow("private-sentinel");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
