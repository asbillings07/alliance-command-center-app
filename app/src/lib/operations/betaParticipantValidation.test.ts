import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runBetaParticipantValidationCheck,
  formatValidationReport,
  BETA_PARTICIPANT_VALIDATION_CHECKS,
} from "./betaParticipantValidation";

const mockQueryRaw = vi.fn();

vi.mock("../prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { prisma } from "../prisma";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runBetaParticipantValidationCheck", () => {
  it("flags null participantId rows", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { id: "inv-1", email: "a@example.test", issuedAt: new Date() },
    ]);

    const result = await runBetaParticipantValidationCheck(
      prisma as never,
      "null_participant_id",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.check).toBe("null_participant_id");
  });

  it("passes cleanly when null participantId check returns zero rows", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const result = await runBetaParticipantValidationCheck(
      prisma as never,
      "null_participant_id",
    );
    expect(result.rows).toHaveLength(0);
  });

  it("flags unflagged multi-user participants", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        participantId: "participant-1",
        distinctAcceptedUserCount: 2,
        acceptedUserIds: ["user-a", "user-b"],
      },
    ]);

    const result = await runBetaParticipantValidationCheck(
      prisma as never,
      "unflagged_multi_user",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.check).toBe("unflagged_multi_user");
  });

  it("flags colliding userId claims", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        userId: "user-a",
        participantCount: 2,
        participantIds: ["p-1", "p-2"],
      },
    ]);

    const result = await runBetaParticipantValidationCheck(
      prisma as never,
      "colliding_user_id",
    );
    expect(result.rows).toHaveLength(1);
  });

  it("flags orphaned participants", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { participantId: "orphan-1", createdAt: new Date() },
    ]);

    const result = await runBetaParticipantValidationCheck(
      prisma as never,
      "orphaned_participant",
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("formatValidationReport", () => {
  it("reports failure when any check has rows", () => {
    const report = formatValidationReport([
      {
        check: "null_participant_id",
        label: BETA_PARTICIPANT_VALIDATION_CHECKS[0].label,
        rows: [{ id: "inv-1" }],
      },
      {
        check: "colliding_user_id",
        label: BETA_PARTICIPANT_VALIDATION_CHECKS[2].label,
        rows: [],
      },
    ]);

    expect(report).toContain("FAILED");
    expect(report).toContain("null_participant_id");
  });

  it("reports success when all checks are clean", () => {
    const report = formatValidationReport(
      BETA_PARTICIPANT_VALIDATION_CHECKS.map(({ check, label }) => ({
        check,
        label,
        rows: [],
      })),
    );
    expect(report).toContain("All checks passed.");
  });
});
