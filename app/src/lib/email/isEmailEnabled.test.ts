import { describe, it, expect, afterEach } from "vitest";
import { isEmailEnabled } from "./isEmailEnabled";

describe("isEmailEnabled", () => {
  const original = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  };

  afterEach(() => {
    process.env.RESEND_API_KEY = original.key;
    process.env.EMAIL_FROM = original.from;
  });

  it("is false when both are absent", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(isEmailEnabled()).toBe(false);
  });

  it("is false when only the API key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    delete process.env.EMAIL_FROM;
    expect(isEmailEnabled()).toBe(false);
  });

  it("is false when only the sender is present", () => {
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "noreply@example.com";
    expect(isEmailEnabled()).toBe(false);
  });

  it("is true when both are present", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "noreply@example.com";
    expect(isEmailEnabled()).toBe(true);
  });
});
