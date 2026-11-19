import "server-only";
import { IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import { googleOcrConfig, OCR_MAX_IMAGE_BYTES, OCR_MAX_RESULT_BYTES, OcrEvaluationError } from "./config";
import { RecognitionFailure } from "./recognitionFailure";
import { allowsTwoSecondRetry, parseVisionResponse, type Recognition } from "./recognition";

class ResponseTooLarge extends Error {}

export interface OcrTransport {
  preflight(): Promise<void>;
  put(name: string, content: Uint8Array, contentType: "image/png" | "application/json"): Promise<void>;
  read(name: string, limit: number): Promise<Uint8Array>;
  recognize(image: { bytes: Uint8Array; width: number; height: number }): Promise<Recognition>;
}

export async function boundedBody(response: Response, limit: number) {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) throw new ResponseTooLarge("Response too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => {}); }
}

export function validateBucketPolicy(value: unknown) {
  const bucket = value as { location?: string; storageClass?: string; iamConfiguration?: {
    publicAccessPrevention?: string; uniformBucketLevelAccess?: { enabled?: boolean }
  }; versioning?: { enabled?: boolean }; softDeletePolicy?: { retentionDurationSeconds?: string };
    retentionPolicy?: unknown; defaultEventBasedHold?: boolean;
    lifecycle?: { rule?: { action?: { type?: string }; condition?: Record<string, unknown> }[] } };
  const rules = bucket?.lifecycle?.rule;
  if (!bucket || !["US", "US-CENTRAL1", "US-EAST1"].includes(bucket.location ?? "") || bucket.storageClass !== "STANDARD"
    || bucket.iamConfiguration?.publicAccessPrevention !== "enforced"
    || bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true
    || bucket.versioning?.enabled === true || bucket.softDeletePolicy?.retentionDurationSeconds !== "0"
    || bucket.retentionPolicy || bucket.defaultEventBasedHold
    || !Array.isArray(rules) || rules.length !== 1 || rules[0].action?.type !== "Delete"
    || JSON.stringify(rules[0].condition) !== '{"age":30}') {
    throw new OcrEvaluationError("Screenshot storage has not passed its privacy and retention checks. No scan was sent.");
  }
}

export function googleOcrTransport(): OcrTransport {
  const config = googleOcrConfig();
  const audience = `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.providerPath}`;
  const auth = new IdentityPoolClient({
    // Credential exchanges retain Google's bounded SDK retries. Paid Vision
    // requests use the separate single-dispatch fetch path below.
    transporterOptions: { timeout: 10_000 },
    audience, subject_token_type: "urn:ietf:params:oauth:token-type:jwt", token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccount}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  async function request(url: string, options: RequestInit = {}) {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error("OCR credentials unavailable");
    // fetch has no automatic HTTP retry. Do not replace this with an SDK that
    // retries paid requests; every recognition dispatch owns one reservation.
    return fetch(url, { ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": config.project, ...options.headers } });
  }
  const objectUrl = (name: string) => `https://storage.googleapis.com/storage/v1/b/${config.bucket}/o/${encodeURIComponent(name)}`;
  return {
    async preflight() {
      const response = await request(`https://storage.googleapis.com/storage/v1/b/${config.bucket}`);
      if (!response.ok) throw new Error("Storage check unavailable");
      validateBucketPolicy(JSON.parse((await boundedBody(response, 32 * 1024)).toString()));
    },
    async put(name, content, contentType) {
      const limit = contentType === "image/png" ? OCR_MAX_IMAGE_BYTES : OCR_MAX_RESULT_BYTES;
      if (content.byteLength > limit) throw new Error("Content too large");
      const response = await request(`https://storage.googleapis.com/upload/storage/v1/b/${config.bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(name)}`,
        { method: "POST", headers: { "Content-Type": contentType }, body: Buffer.from(content) });
      if (!response.ok) throw new Error("Storage write unavailable");
      await response.body?.cancel();
    },
    async read(name, limit) {
      const response = await request(`${objectUrl(name)}?alt=media`);
      if (!response.ok) throw new Error("Retained source unavailable");
      return boundedBody(response, limit);
    },
    async recognize(image) {
      let response: Response;
      try {
        response = await request(`https://us-vision.googleapis.com/v1/projects/${config.project}/locations/us/images:annotate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ image: { content: Buffer.from(image.bytes).toString("base64") }, features: [{ type: "TEXT_DETECTION" }] }] }),
        });
      } catch {
        throw new RecognitionFailure("provider-unavailable");
      }
      const retryAfter = response.headers.get("Retry-After");
      const shortDelayAllowed = retryAfter === null || /^[012]$/.test(retryAfter);
      if (!response.ok) {
        let temporary = response.status === 503 && shortDelayAllowed;
        if (temporary && response.headers.get("Content-Type")?.includes("application/json")) {
          try {
            const body = JSON.parse((await boundedBody(response, 32 * 1024)).toString());
            temporary = !!body?.error && allowsTwoSecondRetry(body.error.details);
          } catch { temporary = false; }
        } else {
          await response.body?.cancel().catch(() => {});
        }
        throw new RecognitionFailure(temporary ? "provider-temporary" : "provider-error");
      }
      try {
        const data = await boundedBody(response, 512 * 1024);
        const recognition = parseVisionResponse(JSON.parse(data.toString()), image.width, image.height, shortDelayAllowed);
        if (Buffer.byteLength(JSON.stringify(recognition)) > OCR_MAX_RESULT_BYTES) throw new RecognitionFailure("retained-result-too-large");
        return recognition;
      } catch (error) {
        if (error instanceof RecognitionFailure) throw error;
        throw new RecognitionFailure(error instanceof ResponseTooLarge ? "provider-response-too-large" : "response-unreadable");
      }
    },
  };
}
