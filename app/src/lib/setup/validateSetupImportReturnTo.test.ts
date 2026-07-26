import { describe, it, expect } from "vitest";
import { validateSetupImportReturnTo } from "./validateSetupImportReturnTo";

describe("validateSetupImportReturnTo", () => {
  const allianceId = "alliance-1";
  const validReturnTo = `/alliances/${allianceId}/setup/import`;

  it("accepts the exact literal setup import path for this alliance", () => {
    expect(validateSetupImportReturnTo(validReturnTo, allianceId)).toBe(validReturnTo);
  });

  it("rejects external URLs", () => {
    expect(
      validateSetupImportReturnTo("https://evil.example/setup/import", allianceId),
    ).toBeNull();
  });

  it("rejects another alliance's setup import path", () => {
    expect(
      validateSetupImportReturnTo("/alliances/other-alliance/setup/import", allianceId),
    ).toBeNull();
  });

  it("rejects non-literal paths under the same alliance", () => {
    expect(
      validateSetupImportReturnTo(`/alliances/${allianceId}/setup`, allianceId),
    ).toBeNull();
    expect(
      validateSetupImportReturnTo(`/alliances/${allianceId}/members/import`, allianceId),
    ).toBeNull();
  });

  it("treats absent values as invalid", () => {
    expect(validateSetupImportReturnTo(undefined, allianceId)).toBeNull();
    expect(validateSetupImportReturnTo(null, allianceId)).toBeNull();
    expect(validateSetupImportReturnTo("", allianceId)).toBeNull();
  });
});
