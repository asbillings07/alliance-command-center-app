import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBackfillManifest,
  runBetaParticipantBackfill,
} from "./betaParticipantBackfillDb";

const mockTransaction = vi.fn();
const mockFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("../prisma", () => ({
  prisma: {
    betaInvitation: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
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
    expect(mockFindMany).toHaveBeenCalledTimes(75);
  });
});

describe("buildBackfillManifest", () => {
  it("includes exhaustive email plan summaries and a stable checksum", () => {
    const summary = {
      dryRun: true as const,
      emailsProcessed: 2,
      emailsSkipped: 0,
      invitationsAssigned: 3,
      participantsCreated: 2,
      mergesPerformed: 0,
      ambiguousFlagsSet: 0,
      emailPlans: [
        {
          email: "a@example.test",
          nullInvitationCount: 1,
          assignmentCount: 1,
          createCount: 1,
          mergeCount: 0,
          ambiguousCount: 0,
        },
        {
          email: "b@example.test",
          nullInvitationCount: 2,
          assignmentCount: 2,
          createCount: 1,
          mergeCount: 0,
          ambiguousCount: 0,
        },
      ],
    };

    const manifest = buildBackfillManifest({
      dbIdentity: "ep-preview-999999",
      pendingNullInvitationCount: 3,
      summary,
    });

    expect(manifest.emailPlans).toHaveLength(2);
    expect(manifest.totals.invitationsAssigned).toBe(3);
    expect(manifest.checksum).toHaveLength(64);
  });
});
