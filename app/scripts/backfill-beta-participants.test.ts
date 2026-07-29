import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertBackfillExecuteAllowed,
  parseBackfillArgs,
} from "../../scripts/backfill-beta-participants";

describe("parseBackfillArgs", () => {
  it("parses execute, production confirmation, and identity flag", () => {
    const args = parseBackfillArgs([
      "--execute",
      "--confirm-production",
      "--yes-i-am-sure-this-is-ep-preview-999999",
    ]);
    expect(args.execute).toBe(true);
    expect(args.confirmProduction).toBe(true);
    expect(args.confirmIdentity).toBe("ep-preview-999999");
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
