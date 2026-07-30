import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertBackfillInboxExecuteAllowed,
  loadAndVerifyApprovedInboxManifest,
  parseBackfillInboxArgs,
} from "../../scripts/backfill-feedback-inbox";
import {
  buildFeedbackInboxBackfillManifest,
  feedbackInboxBackfillManifestChecksumPayload,
  planFeedbackInboxBackfill,
  verifyFeedbackInboxBackfillManifest,
} from "../src/lib/operations/feedbackInboxBackfillDb";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseBackfillInboxArgs", () => {
  it("parses execute, production confirmation, identity flag, and manifest path", () => {
    const args = parseBackfillInboxArgs([
      "--execute",
      "--confirm-production",
      "--yes-i-am-sure-this-is-ep-preview-999999",
      "--manifest",
      "/tmp/manifest.json",
    ]);
    expect(args.execute).toBe(true);
    expect(args.confirmProduction).toBe(true);
    expect(args.confirmIdentity).toBe("ep-preview-999999");
    expect(args.manifestPath).toBe("/tmp/manifest.json");
  });
});

describe("assertBackfillInboxExecuteAllowed", () => {
  beforeEach(() => {
    vi.stubEnv("PRODUCTION_DB_HOSTS", "ep-prod-000000");
  });

  it("refuses execute without identity confirmation", () => {
    expect(() =>
      assertBackfillInboxExecuteAllowed(parseBackfillInboxArgs(["--execute"]), {
        identity: "ep-preview-999999",
        isProduction: false,
        hostname: "ep-preview-999999.us-east-2.aws.neon.tech",
      }),
    ).toThrow(/yes-i-am-sure-this-is-ep-preview-999999/);
  });

  it("refuses production execute without --confirm-production", () => {
    expect(() =>
      assertBackfillInboxExecuteAllowed(
        parseBackfillInboxArgs([
          "--execute",
          "--yes-i-am-sure-this-is-ep-prod-000000",
        ]),
        {
          identity: "ep-prod-000000",
          isProduction: true,
          hostname: "ep-prod-000000.us-east-2.aws.neon.tech",
        },
      ),
    ).toThrow(/confirm-production/);
  });

  it("allows production execute with full confirmation", () => {
    expect(() =>
      assertBackfillInboxExecuteAllowed(
        parseBackfillInboxArgs([
          "--execute",
          "--confirm-production",
          "--yes-i-am-sure-this-is-ep-prod-000000",
        ]),
        {
          identity: "ep-prod-000000",
          isProduction: true,
          hostname: "ep-prod-000000.us-east-2.aws.neon.tech",
        },
      ),
    ).not.toThrow();
  });
});

describe("loadAndVerifyApprovedInboxManifest", () => {
  const manifestPath = join(tmpdir(), `feedback-inbox-backfill-manifest-test-${Date.now()}.json`);

  afterEach(() => {
    try {
      unlinkSync(manifestPath);
    } catch {
      // ignore
    }
  });

  function sampleManifest(dbIdentity: string) {
    const plan = planFeedbackInboxBackfill([]);
    return buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 0,
      plan,
    });
  }

  it("rejects a manifest generated for a different database", async () => {
    writeFileSync(manifestPath, JSON.stringify(sampleManifest("ep-preview-999999")));

    await expect(
      loadAndVerifyApprovedInboxManifest(manifestPath, "ep-prod-000000"),
    ).rejects.toThrow(/manifest was generated for database/);
  });

  it("accepts a well-formed manifest for the current database", async () => {
    const manifest = sampleManifest("ep-preview-999999");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const loaded = await loadAndVerifyApprovedInboxManifest(
      manifestPath,
      "ep-preview-999999",
    );
    expect(loaded.checksum).toBe(manifest.checksum);
  });

  it("verifyFeedbackInboxBackfillManifest rejects stale live plans before execute", () => {
    const plan = planFeedbackInboxBackfill([
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: null,
        hasTriage: false,
      },
    ]);
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity: "ep-preview-999999",
      totalFeedbackRows: 1,
      plan,
    });
    const staleFresh = feedbackInboxBackfillManifestChecksumPayload({
      dbIdentity: "ep-preview-999999",
      totalFeedbackRows: 1,
      plan: planFeedbackInboxBackfill([
        {
          id: "fb2",
          url: "/alliances/a2/members",
          allianceId: null,
          hasTriage: false,
        },
      ]),
    });
    expect(
      verifyFeedbackInboxBackfillManifest(manifest, {
        dbIdentity: "ep-preview-999999",
        payload: staleFresh,
      }).ok,
    ).toBe(false);
  });
});
