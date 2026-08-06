import { describe, expect, it } from "vitest";
import { assertAuditTargetIdentity, parseAuditArgs } from "./apsAuditCli";

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
