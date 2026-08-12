import { describe, it, expect } from "vitest";
import { resolveEnvironmentFrom, toFeatureContext } from "./context";

describe("resolveEnvironmentFrom", () => {
  it("resolves 'production' from VERCEL_ENV=production", () => {
    expect(resolveEnvironmentFrom({ vercelEnv: "production" })).toBe("production");
  });

  it("resolves 'preview' from VERCEL_ENV=preview", () => {
    expect(resolveEnvironmentFrom({ vercelEnv: "preview" })).toBe("preview");
  });

  it("resolves 'development' when VERCEL_ENV is unset (local/CI)", () => {
    expect(resolveEnvironmentFrom({ vercelEnv: undefined })).toBe("development");
  });

  it("resolves 'development' for any other/unrecognized VERCEL_ENV value", () => {
    expect(resolveEnvironmentFrom({ vercelEnv: "something-unexpected" })).toBe("development");
  });
});

describe("toFeatureContext", () => {
  it("builds a context-free context (no authorization) for a global flag", () => {
    const context = toFeatureContext({ environment: "production" });
    expect(context).toEqual({
      environment: "production",
      alliance: undefined,
      userId: undefined,
      isPlatformAdmin: undefined,
    });
  });

  it("derives alliance.id and userId from an AuthorizationContext, never from raw params", () => {
    const context = toFeatureContext({
      environment: "production",
      authorization: {
        user: { id: "user-1", email: "user@example.com" },
        membership: { allianceId: "alliance-1" } as never,
      },
    });
    expect(context.alliance).toEqual({ id: "alliance-1" });
    expect(context.userId).toBe("user-1");
  });

  it("passes through isPlatformAdmin from the DB-backed check, not a JWT hint", () => {
    const context = toFeatureContext({ environment: "production", isPlatformAdmin: true });
    expect(context.isPlatformAdmin).toBe(true);
  });
});
