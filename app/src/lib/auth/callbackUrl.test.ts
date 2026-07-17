import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "./callbackUrl";

describe("sanitizeCallbackUrl", () => {
  it("allows same-origin relative paths", () => {
    expect(sanitizeCallbackUrl("/app")).toBe("/app");
    expect(sanitizeCallbackUrl("/alliances/123")).toBe("/alliances/123");
    expect(sanitizeCallbackUrl("/redeem/abc?code=XYZ")).toBe(
      "/redeem/abc?code=XYZ",
    );
  });

  it("falls back to /app for empty or nullish input", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe("/app");
    expect(sanitizeCallbackUrl(null)).toBe("/app");
    expect(sanitizeCallbackUrl("")).toBe("/app");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(sanitizeCallbackUrl("https://evil.com")).toBe("/app");
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/app");
    expect(sanitizeCallbackUrl("http://localhost/app")).toBe("/app");
  });

  it("rejects backslashes (raw and percent-encoded)", () => {
    expect(sanitizeCallbackUrl("/\\evil.com")).toBe("/app");
    expect(sanitizeCallbackUrl("/%5cevil.com")).toBe("/app");
    expect(sanitizeCallbackUrl("/%5Cevil.com")).toBe("/app");
    expect(sanitizeCallbackUrl("/path\\to")).toBe("/app");
  });

  it("rejects control characters", () => {
    expect(sanitizeCallbackUrl("/app\n")).toBe("/app");
    expect(sanitizeCallbackUrl("/app\t/x")).toBe("/app");
    expect(sanitizeCallbackUrl("/\u0000")).toBe("/app");
    expect(sanitizeCallbackUrl("/\u007f")).toBe("/app");
  });
});
