import { describe, expect, it } from "vitest";
import { assertAuditTargetIdentity, parseAuditArgs } from "./audit-aps-data-readiness";

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
  it("allows a non-production target without any confirmation flag", () => {
    expect(() =>
      assertAuditTargetIdentity(null, { identity: "local-dev", isProduction: false, hostname: "localhost" }),
    ).not.toThrow();
  });

  it("refuses a production target with no confirmation flag", () => {
    expect(() =>
      assertAuditTargetIdentity(null, { identity: "ep-prod-123", isProduction: true, hostname: "prod.example.com" }),
    ).toThrow(/Refusing to audit a production database/);
  });

  it("refuses a production target whose confirmation does not match the resolved identity", () => {
    expect(() =>
      assertAuditTargetIdentity("ep-wrong-123", {
        identity: "ep-prod-123",
        isProduction: true,
        hostname: "prod.example.com",
      }),
    ).toThrow();
  });

  it("allows a production target whose confirmation exactly matches the resolved identity", () => {
    expect(() =>
      assertAuditTargetIdentity("ep-prod-123", {
        identity: "ep-prod-123",
        isProduction: true,
        hostname: "prod.example.com",
      }),
    ).not.toThrow();
  });
});
