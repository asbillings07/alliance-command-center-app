import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertBackfillExecuteAllowed,
  loadAndVerifyApprovedManifest,
  parseBackfillArgs,
} from "../../scripts/backfill-beta-participants";
import {
  buildBackfillManifest,
  verifyBackfillManifest,
  backfillManifestChecksumPayload,
} from "../src/lib/operations/betaParticipantBackfillDb";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseBackfillArgs", () => {
  it("parses execute, production confirmation, identity flag, and manifest path", () => {
    const args = parseBackfillArgs([
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

describe("assertBackfillExecuteAllowed", () => {
  beforeEach(() => {
    vi.stubEnv("PRODUCTION_DB_HOSTS", "ep-prod-000000");
  });

  it("refuses execute without identity confirmation", () => {
    expect(() =>
      assertBackfillExecuteAllowed(parseBackfillArgs(["--execute"]), {
        identity: "ep-preview-999999",
        isProduction: false,
        hostname: "ep-preview-999999.us-east-2.aws.neon.tech",
      }),
    ).toThrow(/yes-i-am-sure-this-is-ep-preview-999999/);
  });

  it("refuses production execute without --confirm-production", () => {
    expect(() =>
      assertBackfillExecuteAllowed(
        parseBackfillArgs([
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
      assertBackfillExecuteAllowed(
        parseBackfillArgs([
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

describe("loadAndVerifyApprovedManifest", () => {
  const manifestPath = join(tmpdir(), `beta-backfill-manifest-test-${Date.now()}.json`);

  afterEach(() => {
    try {
      unlinkSync(manifestPath);
    } catch {
      // ignore
    }
  });

  it("rejects a manifest generated for a different database", async () => {
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 0,
      emailPlans: [],
      totals: {
        emailsProcessed: 0,
        emailsSkipped: 0,
        invitationsAssigned: 0,
        participantsCreated: 0,
        mergesPerformed: 0,
        ambiguousFlagsSet: 0,
      },
    });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await expect(
      loadAndVerifyApprovedManifest(manifestPath, "ep-prod-000000"),
    ).rejects.toThrow(/manifest was generated for database/);
  });

  it("accepts a well-formed manifest for the current database", async () => {
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 0,
      emailPlans: [],
      totals: {
        emailsProcessed: 0,
        emailsSkipped: 0,
        invitationsAssigned: 0,
        participantsCreated: 0,
        mergesPerformed: 0,
        ambiguousFlagsSet: 0,
      },
    });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const loaded = await loadAndVerifyApprovedManifest(
      manifestPath,
      "ep-preview-999999",
    );
    expect(loaded.checksum).toBe(manifest.checksum);
  });

  it("verifyBackfillManifest rejects stale live plans before execute", () => {
    const totals = {
      emailsProcessed: 1,
      emailsSkipped: 0,
      invitationsAssigned: 1,
      participantsCreated: 1,
      mergesPerformed: 0,
      ambiguousFlagsSet: 0,
    };
    const plan = {
      email: "a@example.test",
      nullInvitationCount: 1,
      assignments: [
        {
          invitationId: "inv-1",
          target: {
            kind: "create" as const,
            slotKey: "single",
            userId: null,
            identityAmbiguous: false,
          },
        },
      ],
      mergeParticipantIds: [],
      markAmbiguousParticipantIds: [],
    };
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [plan],
      totals,
    });
    const staleFresh = backfillManifestChecksumPayload({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [
        {
          ...plan,
          assignments: [
            {
              invitationId: "inv-2",
              target: plan.assignments[0]!.target,
            },
          ],
        },
      ],
      totals,
    });
    expect(
      verifyBackfillManifest(manifest, {
        dbIdentity: "ep-preview-999999",
        payload: staleFresh,
      }).ok,
    ).toBe(false);
  });
});
