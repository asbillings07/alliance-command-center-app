import { describe, it, expect } from "vitest";
import { validateSessionVersion } from "./session";

describe("validateSessionVersion", () => {
  it("honors a token whose version matches the database", () => {
    expect(validateSessionVersion(4, 4)).toBe(true);
  });

  it("rejects a token whose version is older than the database", () => {
    expect(validateSessionVersion(3, 4)).toBe(false);
  });

  it("rejects a token whose version is somehow newer than the database", () => {
    expect(validateSessionVersion(5, 4)).toBe(false);
  });

  it("treats a versionless (pre-feature) token as 0", () => {
    // Rollout safety: tokens minted before sessionVersion existed carry no
    // version and must still validate against the default column value (0), so
    // deploying this feature does not force a logout wave.
    expect(validateSessionVersion(undefined, 0)).toBe(true);
  });

  it("rejects a versionless token once the database has advanced past 0", () => {
    expect(validateSessionVersion(undefined, 1)).toBe(false);
  });

  it("honors the baseline case of a brand-new account at version 0", () => {
    expect(validateSessionVersion(0, 0)).toBe(true);
  });
});
