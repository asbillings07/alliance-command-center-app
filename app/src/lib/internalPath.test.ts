import { describe, expect, it } from "vitest";
import { sanitizeInternalPath } from "./internalPath";

describe("sanitizeInternalPath", () => {
  it("returns same-origin relative paths unchanged", () => {
    expect(sanitizeInternalPath("/app")).toBe("/app");
    expect(sanitizeInternalPath("/alliances/123/setup")).toBe(
      "/alliances/123/setup"
    );
    expect(sanitizeInternalPath("/redeem/abc?code=XYZ")).toBe(
      "/redeem/abc?code=XYZ"
    );
  });

  it("returns null for empty or nullish input", () => {
    expect(sanitizeInternalPath(undefined)).toBeNull();
    expect(sanitizeInternalPath(null)).toBeNull();
    expect(sanitizeInternalPath("")).toBeNull();
  });

  it("returns null for absolute and protocol-relative URLs", () => {
    expect(sanitizeInternalPath("https://evil.com")).toBeNull();
    expect(sanitizeInternalPath("//evil.com")).toBeNull();
    expect(sanitizeInternalPath("http://localhost/app")).toBeNull();
  });

  it("returns null for executable schemes and bare words", () => {
    expect(sanitizeInternalPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeInternalPath("data:text/html,x")).toBeNull();
    expect(sanitizeInternalPath("app")).toBeNull();
  });

  it("returns null for backslashes (raw and percent-encoded)", () => {
    expect(sanitizeInternalPath("/\\evil.com")).toBeNull();
    expect(sanitizeInternalPath("/%5cevil.com")).toBeNull();
    expect(sanitizeInternalPath("/%5Cevil.com")).toBeNull();
    expect(sanitizeInternalPath("/path\\to")).toBeNull();
  });

  it("returns null for control characters", () => {
    expect(sanitizeInternalPath("/app\n")).toBeNull();
    expect(sanitizeInternalPath("/app\t/x")).toBeNull();
    expect(sanitizeInternalPath("/\u0000")).toBeNull();
    expect(sanitizeInternalPath("/\u007f")).toBeNull();
  });
});
