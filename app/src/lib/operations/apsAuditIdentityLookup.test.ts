import { describe, expect, it } from "vitest";
import { resolveApsAuditTargetIdentity } from "./apsAuditIdentityLookup";

describe("resolveApsAuditTargetIdentity", () => {
  it("resolves the identity from a provided env, without touching process.env", () => {
    const identity = resolveApsAuditTargetIdentity({
      DATABASE_URL: "postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    });
    expect(identity).toBe("ep-cool-name-123456");
  });

  it("throws a generic error, without leaking any partial connection info, when DATABASE_URL is missing", () => {
    expect(() => resolveApsAuditTargetIdentity({})).toThrow(/DATABASE_URL is required/);
  });

  it("falls back to the full hostname for a non-Neon host", () => {
    const identity = resolveApsAuditTargetIdentity({ DATABASE_URL: "postgresql://u:p@db.internal.example.com:5433/x" });
    expect(identity).toBe("db.internal.example.com:5433");
  });
});
