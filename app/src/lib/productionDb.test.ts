import { describe, it, expect } from "vitest";
import {
  connectionIdentity,
  productionIdentities,
  dbEnvKind,
  checkDbIdentity,
} from "./productionDb";

const PROD_POOLED =
  "postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
const PROD_DIRECT =
  "postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=require";
const PREVIEW_POOLED =
  "postgresql://u:p@ep-preview-999999-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
const SECOND_PROD_DIRECT =
  "postgresql://u:p@ep-second-prod-777777.us-east-2.aws.neon.tech/db?sslmode=require";

describe("connectionIdentity", () => {
  it("collapses pooled and direct Neon hosts to the same endpoint id", () => {
    expect(connectionIdentity(PROD_POOLED)).toBe("ep-cool-name-123456");
    expect(connectionIdentity(PROD_DIRECT)).toBe("ep-cool-name-123456");
    expect(connectionIdentity(PROD_POOLED)).toBe(connectionIdentity(PROD_DIRECT));
  });

  it("falls back to the full host for non-Neon providers, with a non-default port preserved", () => {
    expect(connectionIdentity("postgresql://u:p@db.internal.example.com:5433/x")).toBe(
      "db.internal.example.com:5433"
    );
  });

  it("throws on a malformed connection string", () => {
    expect(() => connectionIdentity("not-a-url")).toThrow();
  });

  // Regression: a host is never trusted as a Neon endpoint just because its
  // first label starts with `ep-`. Only *.neon.tech is scoped for endpoint-id
  // extraction; anything else keeps its exact hostname, so a lookalike host
  // can never collide with a real Neon identity.
  it("does not collapse a non-Neon lookalike host into the Neon endpoint id", () => {
    const lookalike = connectionIdentity("postgresql://u:p@ep-prod-123.example.com/db");
    const realNeon = connectionIdentity(
      "postgresql://u:p@ep-prod-123.us-east-2.aws.neon.tech/db"
    );
    expect(lookalike).toBe("ep-prod-123.example.com");
    expect(realNeon).toBe("ep-prod-123");
    expect(lookalike).not.toBe(realNeon);
  });
});

describe("productionIdentities", () => {
  it("parses endpoint ids, hosts, and full URLs uniformly", () => {
    const ids = productionIdentities(
      `ep-cool-name-123456-pooler, ep-cool-name-123456.us-east-2.aws.neon.tech ${PROD_DIRECT}`
    );
    expect(new Set(ids)).toEqual(new Set(["ep-cool-name-123456"]));
  });

  it("is empty for undefined/blank", () => {
    expect(productionIdentities(undefined)).toEqual([]);
    expect(productionIdentities("   ")).toEqual([]);
  });

  it("normalizes bare endpoint id casing so PRODUCTION_DB_HOSTS is not case-sensitive", () => {
    expect(productionIdentities("EP-COOL-NAME-123456")).toEqual(["ep-cool-name-123456"]);
    expect(productionIdentities("EP-COOL-NAME-123456-POOLER")).toEqual([
      "ep-cool-name-123456",
    ]);
  });

  it("treats a bare id with a non-default port as a host, not a bare endpoint id", () => {
    // A bare endpoint id has no port; `ep-x-123:5433` must be parsed as a host
    // via connectionIdentity (a non-Neon host keeps its exact identity,
    // including a non-default port — see the port-preservation test below).
    expect(productionIdentities("ep-x-123:5433")).toEqual(["ep-x-123:5433"]);
  });
});

describe("connectionIdentity port handling", () => {
  it("keeps a NON-default port for a non-Neon host, so two instances on one hostname stay distinct", () => {
    const a = connectionIdentity("postgresql://u:p@db.example.com:5433/foo");
    const b = connectionIdentity("postgresql://u:p@db.example.com:5434/bar");
    expect(a).toBe("db.example.com:5433");
    expect(b).toBe("db.example.com:5434");
    expect(a).not.toBe(b);
  });

  it("normalizes the DEFAULT Postgres port (5432) away, since specifying it is equivalent to omitting it", () => {
    const explicit = connectionIdentity("postgresql://u:p@db.example.com:5432/foo");
    const omitted = connectionIdentity("postgresql://u:p@db.example.com/foo");
    expect(explicit).toBe("db.example.com");
    expect(explicit).toBe(omitted);
  });

  it("ignores the port for a Neon host (endpoint id is already port-independent)", () => {
    expect(
      connectionIdentity("postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech:5432/db")
    ).toBe("ep-cool-name-123456");
    expect(
      connectionIdentity("postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech:5433/db")
    ).toBe("ep-cool-name-123456");
  });

  it("omits the port from a non-Neon identity when none is specified", () => {
    expect(connectionIdentity("postgresql://u:p@db.example.com/foo")).toBe("db.example.com");
  });
});

describe("dbEnvKind", () => {
  it("maps VERCEL_ENV to the policed kinds", () => {
    expect(dbEnvKind({ VERCEL_ENV: "production" })).toBe(
      "production"
    );
    expect(dbEnvKind({ VERCEL_ENV: "preview" })).toBe(
      "preview"
    );
    expect(dbEnvKind({})).toBe("other");
  });
});

describe("checkDbIdentity", () => {
  it("does not constrain local/CI (other) environments", () => {
    expect(
      checkDbIdentity({ DATABASE_URL: PROD_POOLED })
    ).toEqual([]);
  });

  it("requires PRODUCTION_DB_HOSTS on Vercel", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_POOLED,
    });
    expect(problems.join("\n")).toMatch(/PRODUCTION_DB_HOSTS is required/);
  });

  it("passes in production when every connection resolves to a prod identity (pooled + direct)", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "production",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456",
      DATABASE_URL: PROD_POOLED,
      DIRECT_URL: PROD_DIRECT,
    });
    expect(problems).toEqual([]);
  });

  it("fails in preview when a connection resolves to the production identity", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "preview",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456",
      DATABASE_URL: PROD_POOLED,
    });
    expect(problems.join("\n")).toMatch(/must never connect to production/i);
  });

  it("fails in preview even when only DIRECT_URL leaks the production identity", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "preview",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456",
      DATABASE_URL: PREVIEW_POOLED,
      DIRECT_URL: PROD_DIRECT,
    });
    expect(problems.join("\n")).toMatch(/DIRECT_URL/);
  });

  it("passes in preview when connections use a separate branch", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "preview",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456",
      DATABASE_URL: PREVIEW_POOLED,
    });
    expect(problems).toEqual([]);
  });

  it("fails in production when the connection is NOT a prod identity", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "production",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456",
      DATABASE_URL: PREVIEW_POOLED,
    });
    expect(problems.join("\n")).toMatch(/production must use a production database/);
  });

  it("fails when DATABASE_URL and DIRECT_URL each pass the allowlist but point at DIFFERENT production databases", () => {
    // A single-identity allowlist check on each var independently isn't
    // enough once PRODUCTION_DB_HOSTS names more than one production
    // identity (e.g. mid-migration): both could be "a" production database
    // while runtime and migrations silently point at two different ones.
    const problems = checkDbIdentity({
      VERCEL_ENV: "production",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456,ep-second-prod-777777",
      DATABASE_URL: PROD_POOLED,
      DIRECT_URL: SECOND_PROD_DIRECT,
    });
    expect(problems.join("\n")).toMatch(
      /DATABASE_URL and DIRECT_URL resolve to different database identities/
    );
  });

  it("passes when DATABASE_URL and DIRECT_URL are the same production database, even with a multi-identity allowlist", () => {
    const problems = checkDbIdentity({
      VERCEL_ENV: "production",
      PRODUCTION_DB_HOSTS: "ep-cool-name-123456,ep-second-prod-777777",
      DATABASE_URL: PROD_POOLED,
      DIRECT_URL: PROD_DIRECT,
    });
    expect(problems).toEqual([]);
  });
});
