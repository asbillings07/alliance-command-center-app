import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

vi.mock("../prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../prisma";
import {
  listBetaParticipants,
  listBetaParticipantsNeedingAttention,
} from "./betaParticipants";

type SqlFragment = {
  strings: string[];
  values: unknown[];
};

/** Flatten nested Prisma.Sql fragments for SQL-level assertions. */
export function stringifyPrismaSql(sql: unknown): string {
  if (!sql || typeof sql !== "object" || !("strings" in sql)) {
    return String(sql);
  }

  const fragment = sql as SqlFragment;
  let result = fragment.strings[0] ?? "";
  for (let i = 0; i < fragment.values.length; i++) {
    result += stringifyPrismaSql(fragment.values[i]);
    result += fragment.strings[i + 1] ?? "";
  }
  return result;
}

function captureQueryRawSql(): string {
  const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
  expect(call).toBeDefined();
  return stringifyPrismaSql(call![0]);
}

const INVITATION_SECRET_PATTERNS = [
  /\bbi\.\*/,
  /"code"/,
  /"token"/,
  /"notes"/,
  /"issuedByUserId"/,
  /"revokedByUserId"/,
  /"acceptedByUserId"/,
  /\bissued_by\b/,
  /\brevoked_by\b/,
  /\baccepted_by\b/,
  /\blatest_code\b/,
  /\blatest_token\b/,
  /\blatest_notes\b/,
];

describe("beta participant SQL secret exclusion", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("listBetaParticipantsNeedingAttention executed SQL excludes invitation secrets", async () => {
    const now = new Date("2026-07-29T12:00:00Z");

    await listBetaParticipantsNeedingAttention({ now, limit: 10 });

    const sql = captureQueryRawSql();
    for (const pattern of INVITATION_SECRET_PATTERNS) {
      expect(sql).not.toMatch(pattern);
    }
  });

  it("listBetaParticipants page query hydrates invitation secrets for list rows", async () => {
    const now = new Date("2026-07-29T12:00:00Z");

    await listBetaParticipants({}, 1, 10, now);

    const sql = captureQueryRawSql();
    expect(sql).toMatch(/JOIN "BetaInvitation" bi ON bi\.id = f\.latest_attempt_id/);
    expect(sql).toMatch(/bi\.code AS latest_code/);
    expect(sql).toMatch(/bi\.token AS latest_token/);
    expect(sql).toMatch(/bi\.notes AS latest_notes/);
    expect(sql).toMatch(/"issuedByUserId" AS latest_issued_by_user_id/);
    expect(sql).toMatch(/\bissued_by\b/);
  });
});

describe("stringifyPrismaSql", () => {
  it("interleaves nested Prisma.Sql fragments", () => {
    const inner = Prisma.sql`SELECT 1`;
    const outer = Prisma.sql`WITH ${inner} SELECT 2`;
    expect(stringifyPrismaSql(outer)).toContain("WITH SELECT 1 SELECT 2");
  });
});
