import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyParticipantMergeChain,
  buildBackfillManifest,
  buildBackfillManifestChecksum,
  backfillManifestChecksumPayload,
  runBetaParticipantBackfill,
  verifyBackfillManifest,
  verifyBackfillManifestIntegrity,
} from "./betaParticipantBackfillDb";

const mockTransaction = vi.fn();
const mockFindMany = vi.fn();
const mockQueryRaw = vi.fn();
const mockParticipantFindMany = vi.fn();
const mockMerge = vi.fn();

vi.mock("../betaParticipantIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../betaParticipantIdentity")>();
  return {
    ...actual,
    mergeBetaParticipantsWithTx: (...args: unknown[]) => mockMerge(...args),
  };
});

vi.mock("../prisma", () => ({
  prisma: {
    betaInvitation: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    betaParticipant: {
      findMany: (...args: unknown[]) => mockParticipantFindMany(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { prisma } from "../prisma";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
});

describe("runBetaParticipantBackfill dry-run exhaustiveness", () => {
  it("processes every email group in dry-run mode, not just the first batch", async () => {
    const emails = Array.from({ length: 75 }, (_, i) => `user${i}@example.test`);
    mockQueryRaw.mockResolvedValue(emails.map((email) => ({ email })));

    mockFindMany.mockImplementation(({ where }: { where: { email: string } }) => {
      if (where.email === "user0@example.test") {
        return [
          {
            id: "inv-0",
            participantId: null,
            acceptedAt: null,
            acceptedByUserId: null,
          },
        ];
      }
      return [
        {
          id: `inv-${where.email}`,
          participantId: "existing",
          acceptedAt: null,
          acceptedByUserId: null,
        },
      ];
    });

    const summary = await runBetaParticipantBackfill(prisma as never, {
      dryRun: true,
    });

    expect(summary.emailsProcessed).toBe(1);
    expect(summary.emailsSkipped).toBe(74);
    expect(summary.emailPlans).toHaveLength(1);
    expect(summary.planRecords).toHaveLength(1);
    expect(summary.planRecords[0]?.assignments).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledTimes(75);
  });
});

describe("buildBackfillManifest", () => {
  const samplePlanRecord = {
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

  it("includes deterministic assignment identities and a stable checksum", () => {
    const totals = {
      emailsProcessed: 1,
      emailsSkipped: 0,
      invitationsAssigned: 1,
      participantsCreated: 1,
      mergesPerformed: 0,
      ambiguousFlagsSet: 0,
    };
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [samplePlanRecord],
      totals,
    });

    expect(manifest.emailPlans[0]?.assignments[0]?.invitationId).toBe("inv-1");
    expect(manifest.checksum).toHaveLength(64);
  });

  it("verifyBackfillManifestIntegrity rejects a tampered manifest", () => {
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [samplePlanRecord],
      totals: {
        emailsProcessed: 1,
        emailsSkipped: 0,
        invitationsAssigned: 1,
        participantsCreated: 1,
        mergesPerformed: 0,
        ambiguousFlagsSet: 0,
      },
    });
    const tampered = {
      ...manifest,
      totals: { ...manifest.totals, invitationsAssigned: 99 },
    };
    expect(verifyBackfillManifestIntegrity(tampered).ok).toBe(false);
  });

  it("verifyBackfillManifest rejects a stale re-resolved plan", () => {
    const totals = {
      emailsProcessed: 1,
      emailsSkipped: 0,
      invitationsAssigned: 1,
      participantsCreated: 1,
      mergesPerformed: 0,
      ambiguousFlagsSet: 0,
    };
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [samplePlanRecord],
      totals,
    });
    const freshPayload = backfillManifestChecksumPayload({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 2,
      emailPlans: [samplePlanRecord],
      totals,
    });
    expect(
      verifyBackfillManifest(manifest, {
        dbIdentity: "ep-preview-999999",
        payload: freshPayload,
      }).ok,
    ).toBe(false);
  });

  it("verifyBackfillManifest rejects the wrong database identity", () => {
    const totals = {
      emailsProcessed: 1,
      emailsSkipped: 0,
      invitationsAssigned: 1,
      participantsCreated: 1,
      mergesPerformed: 0,
      ambiguousFlagsSet: 0,
    };
    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [samplePlanRecord],
      totals,
    });
    const payload = backfillManifestChecksumPayload({
      dbIdentity: "ep-prod-000000",
      pendingNullInvitationCount: 1,
      emailPlans: [samplePlanRecord],
      totals,
    });
    expect(
      verifyBackfillManifest(manifest, {
        dbIdentity: "ep-prod-000000",
        payload,
      }).ok,
    ).toBe(false);
  });
});

describe("applyParticipantMergeChain", () => {
  it("merges every participant onto the oldest survivor, not the lexicographic planner survivor", async () => {
    mockParticipantFindMany.mockResolvedValue([
      { id: "participant-old" },
      { id: "participant-mid" },
      { id: "participant-new" },
    ]);

    const merges = await applyParticipantMergeChain(prisma as never, [
      { survivorId: "participant-new", mergedAwayId: "participant-mid" },
      { survivorId: "participant-new", mergedAwayId: "participant-old" },
    ]);

    expect(merges).toBe(2);
    expect(mockMerge).toHaveBeenCalledTimes(2);
    expect(mockMerge).toHaveBeenNthCalledWith(
      1,
      prisma,
      "participant-mid",
      "participant-old",
    );
    expect(mockMerge).toHaveBeenNthCalledWith(
      2,
      prisma,
      "participant-new",
      "participant-old",
    );
  });
});

describe("buildBackfillManifestChecksum stability", () => {
  it("changes when assignment identities change", () => {
    const base = backfillManifestChecksumPayload({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 1,
      emailPlans: [
        {
          email: "a@example.test",
          nullInvitationCount: 1,
          assignments: [
            {
              invitationId: "inv-1",
              target: {
                kind: "create",
                slotKey: "single",
                userId: null,
                identityAmbiguous: false,
              },
            },
          ],
          mergeParticipantIds: [],
          markAmbiguousParticipantIds: [],
        },
      ],
      totals: {
        emailsProcessed: 1,
        emailsSkipped: 0,
        invitationsAssigned: 1,
        participantsCreated: 1,
        mergesPerformed: 0,
        ambiguousFlagsSet: 0,
      },
    });
    const altered = {
      ...base,
      emailPlans: [
        {
          ...base.emailPlans[0]!,
          assignments: [
            {
              invitationId: "inv-2",
              target: base.emailPlans[0]!.assignments[0]!.target,
            },
          ],
        },
      ],
    };
    expect(buildBackfillManifestChecksum(base)).not.toBe(
      buildBackfillManifestChecksum(altered),
    );
  });
});
