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

describe("connectionIdentity", () => {
  it("collapses pooled and direct Neon hosts to the same endpoint id", () => {
    expect(connectionIdentity(PROD_POOLED)).toBe("ep-cool-name-123456");
    expect(connectionIdentity(PROD_DIRECT)).toBe("ep-cool-name-123456");
    expect(connectionIdentity(PROD_POOLED)).toBe(connectionIdentity(PROD_DIRECT));
  });

  it("falls back to the full host for non-Neon providers", () => {
    expect(connectionIdentity("postgresql://u:p@db.internal.example.com:5432/x")).toBe(
      "db.internal.example.com"
    );
  });

  it("throws on a malformed connection string", () => {
    expect(() => connectionIdentity("not-a-url")).toThrow();
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
});
