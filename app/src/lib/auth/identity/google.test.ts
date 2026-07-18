import { describe, it, expect, afterEach } from "vitest";
import {
  assertGoogleSubject,
  assertVerifiedGoogleEmail,
  isGoogleAuthEnabled,
} from "./google";
import { MissingGoogleSubjectError, UnverifiedEmailError } from "./errors";

describe("assertVerifiedGoogleEmail", () => {
  it("returns the normalized email for a verified profile", () => {
    const email = assertVerifiedGoogleEmail({
      email: "  User@Example.COM ",
      email_verified: true,
      name: "User",
    });
    expect(email).toBe("user@example.com");
  });

  it("throws UnverifiedEmailError when email_verified is not true", () => {
    expect(() =>
      assertVerifiedGoogleEmail({ email: "user@example.com", email_verified: false })
    ).toThrow(UnverifiedEmailError);
  });

  it("throws UnverifiedEmailError when email_verified is missing", () => {
    expect(() =>
      assertVerifiedGoogleEmail({ email: "user@example.com" })
    ).toThrow(UnverifiedEmailError);
  });

  it("throws UnverifiedEmailError when email is missing but verified", () => {
    expect(() =>
      assertVerifiedGoogleEmail({ email_verified: true })
    ).toThrow(UnverifiedEmailError);
  });
});

describe("assertGoogleSubject", () => {
  it("returns the subject when present", () => {
    expect(assertGoogleSubject({ sub: "1234567890" })).toBe("1234567890");
  });

  it("trims surrounding whitespace", () => {
    expect(assertGoogleSubject({ sub: "  abc  " })).toBe("abc");
  });

  it("throws MissingGoogleSubjectError when sub is missing", () => {
    expect(() => assertGoogleSubject({ email: "user@example.com" })).toThrow(
      MissingGoogleSubjectError
    );
  });

  it("throws MissingGoogleSubjectError when sub is blank", () => {
    expect(() => assertGoogleSubject({ sub: "   " })).toThrow(
      MissingGoogleSubjectError
    );
  });
});

describe("isGoogleAuthEnabled", () => {
  const original = {
    id: process.env.AUTH_GOOGLE_ID,
    secret: process.env.AUTH_GOOGLE_SECRET,
  };

  afterEach(() => {
    process.env.AUTH_GOOGLE_ID = original.id;
    process.env.AUTH_GOOGLE_SECRET = original.secret;
  });

  it("is false when credentials are absent", () => {
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
    expect(isGoogleAuthEnabled()).toBe(false);
  });

  it("is false when only one credential is present", () => {
    process.env.AUTH_GOOGLE_ID = "id";
    delete process.env.AUTH_GOOGLE_SECRET;
    expect(isGoogleAuthEnabled()).toBe(false);
  });

  it("is true when both credentials are present", () => {
    process.env.AUTH_GOOGLE_ID = "id";
    process.env.AUTH_GOOGLE_SECRET = "secret";
    expect(isGoogleAuthEnabled()).toBe(true);
  });
});
