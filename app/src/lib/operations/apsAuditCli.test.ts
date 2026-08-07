import { describe, expect, it } from "vitest";
import { assertAuditTargetIdentity, formatAuditCliFailureMessage, parseAuditArgs } from "./apsAuditCli";
import { AuditUsageError } from "./apsAuditUsageError";

describe("parseAuditArgs", () => {
  it("parses a comma-separated alliance-ids list", () => {
    const { allianceIds } = parseAuditArgs(["--alliance-ids=abc,def,ghi"]);
    expect(allianceIds).toEqual(["abc", "def", "ghi"]);
  });

  it("trims whitespace and drops empty entries", () => {
    const { allianceIds } = parseAuditArgs(["--alliance-ids= abc , , def "]);
    expect(allianceIds).toEqual(["abc", "def"]);
  });

  it("defaults to an empty allowlist when the flag is omitted", () => {
    const { allianceIds } = parseAuditArgs([]);
    expect(allianceIds).toEqual([]);
  });

  it("parses the identity confirmation flag", () => {
    const { confirmIdentity } = parseAuditArgs(["--yes-i-am-sure-this-is-ep-prod-123"]);
    expect(confirmIdentity).toBe("ep-prod-123");
  });

  it("returns null confirmIdentity when not supplied", () => {
    const { confirmIdentity } = parseAuditArgs(["--alliance-ids=abc"]);
    expect(confirmIdentity).toBeNull();
  });
});

describe("assertAuditTargetIdentity", () => {
  it("allows a positively-local hostname without any confirmation flag", () => {
    expect(() =>
      assertAuditTargetIdentity(null, { identity: "local-dev", isProduction: false, hostname: "localhost" }),
    ).not.toThrow();
    expect(() =>
      assertAuditTargetIdentity(null, { identity: "local-dev", isProduction: false, hostname: "127.0.0.1" }),
    ).not.toThrow();
  });

  it("refuses a non-local target flagged production with no confirmation flag", () => {
    expect(() =>
      assertAuditTargetIdentity(null, { identity: "ep-prod-123", isProduction: true, hostname: "prod.example.com" }),
    ).toThrow(/Refusing to audit a non-local database/);
  });

  it("never discloses the hostname, identity, or production classification in the thrown message -- identity lookup is a separate, explicit action", () => {
    try {
      assertAuditTargetIdentity(null, {
        identity: "ep-prod-123",
        isProduction: true,
        hostname: "prod-super-secret-host.example.com",
      });
      throw new Error("expected assertAuditTargetIdentity to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("prod-super-secret-host.example.com");
      expect(message).not.toContain("ep-prod-123");
      // The env-var name itself is generic operator guidance, not a
      // disclosure of THIS target's classification -- but the message must
      // never state that this specific target was flagged as production.
      expect(message).not.toMatch(/flagged.*production/i);
      // Points the operator at the separate, deliberate lookup script instead.
      expect(message).toContain("show-aps-audit-target-identity.ts");
    }
  });

  it("fails CLOSED: refuses a non-local target even when isProduction is false (unset/incomplete PRODUCTION_DB_HOSTS)", () => {
    // This is the regression case: a real remote database that PRODUCTION_DB_HOSTS
    // doesn't (yet) know about must still require confirmation -- it must
    // never be treated as safe just because nothing flagged it "production."
    expect(() =>
      assertAuditTargetIdentity(null, {
        identity: "ep-unknown-remote-456",
        isProduction: false,
        hostname: "ep-unknown-remote-456.us-east-1.aws.neon.tech",
      }),
    ).toThrow(/Refusing to audit a non-local database/);
  });

  it("refuses a non-local target whose confirmation does not match the resolved identity", () => {
    expect(() =>
      assertAuditTargetIdentity("ep-wrong-123", {
        identity: "ep-prod-123",
        isProduction: true,
        hostname: "prod.example.com",
      }),
    ).toThrow();
  });

  it("allows a non-local target whose confirmation exactly matches the resolved identity", () => {
    expect(() =>
      assertAuditTargetIdentity("ep-prod-123", {
        identity: "ep-prod-123",
        isProduction: true,
        hostname: "prod.example.com",
      }),
    ).not.toThrow();
  });

  it("allows a non-local, non-production-flagged target once its exact identity is confirmed", () => {
    expect(() =>
      assertAuditTargetIdentity("ep-unknown-remote-456", {
        identity: "ep-unknown-remote-456",
        isProduction: false,
        hostname: "ep-unknown-remote-456.us-east-1.aws.neon.tech",
      }),
    ).not.toThrow();
  });
});

describe("formatAuditCliFailureMessage", () => {
  it("echoes the message verbatim for an AuditUsageError", () => {
    const message = formatAuditCliFailureMessage(new AuditUsageError("Refusing to run: missing --alliance-ids."));
    expect(message).toContain("Refusing to run: missing --alliance-ids.");
  });

  it("echoes the message verbatim for an AuditUsageError subclass (e.g. AllianceAllowlistError)", () => {
    class SomeSubclass extends AuditUsageError {}
    const message = formatAuditCliFailureMessage(new SomeSubclass("Refusing to run: 2 duplicate alliance id(s)."));
    expect(message).toContain("Refusing to run: 2 duplicate alliance id(s).");
  });

  it("suppresses the message entirely for a plain Error, even one shaped like a real Prisma connection failure", () => {
    // The exact shape Prisma throws when it can't reach a Neon/Postgres
    // host -- the regression this exists to prevent is this string
    // reaching stderr/CI logs unchanged.
    const prismaLikeError = new Error(
      "Can't reach database server at `ep-secret-prod-host-123456-pooler.us-east-2.aws.neon.tech:5432`",
    );
    const message = formatAuditCliFailureMessage(prismaLikeError);
    expect(message).not.toContain("ep-secret-prod-host-123456");
    expect(message).not.toContain("Can't reach database server");
    expect(message).toContain("unexpected error");
  });

  it("suppresses the message entirely for a raw thrown string/non-Error value", () => {
    const message = formatAuditCliFailureMessage("some raw string containing a secret-looking-host.example.com");
    expect(message).not.toContain("secret-looking-host");
    expect(message).toContain("unexpected error");
  });

  it("suppresses a query-argument-shaped error message (e.g. echoing an allowlisted alliance id)", () => {
    const queryErrorShape = new Error(
      "Invalid `tx.alliance.findMany()` invocation: Argument id: got invalid value 'cln_secret_tenant_id_123'",
    );
    const message = formatAuditCliFailureMessage(queryErrorShape);
    expect(message).not.toContain("cln_secret_tenant_id_123");
  });
});
