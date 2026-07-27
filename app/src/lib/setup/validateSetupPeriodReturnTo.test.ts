import { describe, it, expect } from "vitest";
import { validateSetupPeriodReturnTo } from "./validateSetupPeriodReturnTo";

describe("validateSetupPeriodReturnTo", () => {
  const allianceId = "alliance-1";
  const validReturnTo = `/alliances/${allianceId}/periods/period-123`;

  it("accepts the exact period detail path for this alliance", () => {
    expect(validateSetupPeriodReturnTo(validReturnTo, allianceId)).toBe(
      validReturnTo,
    );
  });

  it("rejects external URLs", () => {
    expect(
      validateSetupPeriodReturnTo(
        "https://evil.example/periods/period-123",
        allianceId,
      ),
    ).toBeNull();
  });

  it("rejects another alliance's period path", () => {
    expect(
      validateSetupPeriodReturnTo(
        "/alliances/other-alliance/periods/period-123",
        allianceId,
      ),
    ).toBeNull();
  });

  it("rejects nested paths under the same period", () => {
    expect(
      validateSetupPeriodReturnTo(
        `/alliances/${allianceId}/periods/period-123/import`,
        allianceId,
      ),
    ).toBeNull();
  });

  it("treats absent values as invalid", () => {
    expect(validateSetupPeriodReturnTo(undefined, allianceId)).toBeNull();
    expect(validateSetupPeriodReturnTo(null, allianceId)).toBeNull();
    expect(validateSetupPeriodReturnTo("", allianceId)).toBeNull();
  });
});
