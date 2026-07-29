import { describe, it, expect, vi } from "vitest";
import {
  assertValidationTargetIdentity,
  parseValidateArgs,
} from "../../scripts/validate-beta-participants";

describe("parseValidateArgs", () => {
  it("parses the database identity confirmation flag", () => {
    expect(
      parseValidateArgs(["--yes-i-am-sure-this-is-ep-prod-000000"])
        .confirmIdentity,
    ).toBe("ep-prod-000000");
  });
});

describe("assertValidationTargetIdentity", () => {
  it("refuses validation without the expected database identity", () => {
    expect(() =>
      assertValidationTargetIdentity(null, {
        identity: "ep-prod-000000",
        isProduction: true,
        hostname: "ep-prod-000000.us-east-2.aws.neon.tech",
      }),
    ).toThrow(/yes-i-am-sure-this-is-ep-prod-000000/);
  });

  it("allows validation when the identity matches", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      assertValidationTargetIdentity("ep-preview-999999", {
        identity: "ep-preview-999999",
        isProduction: false,
        hostname: "ep-preview-999999.us-east-2.aws.neon.tech",
      }),
    ).not.toThrow();
    log.mockRestore();
  });
});
