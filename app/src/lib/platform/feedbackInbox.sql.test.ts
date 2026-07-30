import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

vi.mock("../prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../prisma";
import {
  listFeedbackForTriage,
  buildFeedbackInboxFilterSqlForTest,
  feedbackInboxDerivationCte,
} from "./feedbackInbox";

type SqlFragment = {
  strings: string[];
  values: unknown[];
};

/** Flatten nested Prisma.Sql fragments for SQL-level assertions. */
function stringifyPrismaSql(sql: unknown): string {
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

describe("feedbackInbox SQL shape", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("listFeedbackForTriage executes exactly one $queryRaw call", async () => {
    await listFeedbackForTriage({}, 1, 10);
    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(1);
  });

  it("derivation CTE uses LEFT JOIN for FeedbackTriage with coalesced defaults", () => {
    const sql = stringifyPrismaSql(feedbackInboxDerivationCte());
    expect(sql).toMatch(/LEFT JOIN "FeedbackTriage"/);
    expect(sql).toMatch(/COALESCE\(ft\.status, 'NEW'/);
    expect(sql).toMatch(/COALESCE\(ft\."needsResponse", TRUE\)/);
    expect(sql).toMatch(/COALESCE\(ft\."stateRevision", 0\)/);
    expect(sql).toMatch(/has_been_triaged/);
  });

  it("listFeedbackForTriage search filter uses EXISTS for historical invitation emails", async () => {
    const sql = buildFeedbackInboxFilterSqlForTest(
      { search: "historical@example.test" },
      "%historical@example.test%",
      "",
    );
    expect(sql).toMatch(/EXISTS \(/);
    expect(sql).toMatch(/"BetaInvitation" bi_search/);
    expect(sql).not.toMatch(
      /JOIN "BetaInvitation" bi_search ON bi_search\.email ILIKE/,
    );
  });

  it("listFeedbackForTriage unified query computes facet aggregates", async () => {
    await listFeedbackForTriage({ status: "NEW" }, 1, 10);
    const sql = captureQueryRawSql();
    expect(sql).toMatch(/AS total,/);
    expect(sql).toMatch(/AS total_matching_other_facets/);
    expect(sql).toMatch(/status_new/);
    expect(sql).toMatch(/needs_response_count/);
    expect(sql).toMatch(/row_kind/);
  });

  it("buildFeedbackInboxFilterSqlForTest excludes status when requested", () => {
    const full = buildFeedbackInboxFilterSqlForTest(
      { status: "NEW", category: "BUG" },
      "",
      "",
    );
    const exceptStatus = buildFeedbackInboxFilterSqlForTest(
      { status: "NEW", category: "BUG" },
      "",
      "",
      { excludeStatus: true },
    );
    expect(full).toContain("BUG");
    expect(exceptStatus).toContain("BUG");
    expect(exceptStatus).not.toMatch(/d\.status =/);
  });
});

describe("feedbackInbox stringifyPrismaSql", () => {
  it("interleaves nested Prisma.Sql fragments", () => {
    const inner = Prisma.sql`SELECT 1`;
    const outer = Prisma.sql`WITH ${inner} SELECT 2`;
    expect(stringifyPrismaSql(outer)).toContain("WITH SELECT 1 SELECT 2");
  });
});
