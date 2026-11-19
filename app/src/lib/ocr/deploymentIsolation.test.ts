import { describe, expect, it } from "vitest";
import { checkOcrDeploymentIsolation } from "./deploymentIsolation";
import { parse } from "pg-connection-string";

const connection = (id: string) => `postgresql://test:private-password@${id}.us-east-1.aws.neon.tech/neondb`;
const valid = {
  VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "acc-ocr-eval",
  VERCEL_GIT_COMMIT_REF: "codex/ocr-recognition-trial",
  PRODUCTION_DB_HOSTS: "ep-production-123", OCR_EVAL_SHARED_DB_HOSTS: "ep-preview-456",
  OCR_EVAL_DB_IDENTITY: "ep-ocr-789",
  DATABASE_URL: connection("ep-ocr-789-pooler"), DIRECT_URL: connection("ep-ocr-789"),
};

describe("OCR pre-migration isolation", () => {
  it("accepts pooled/runtime and direct/migration connections to the dedicated database", () => {
    expect(checkOcrDeploymentIsolation(valid)).toEqual([]);
  });
  it.each([
    { VERCEL_ENV: "production" }, { VERCEL_TARGET_ENV: "preview" },
    { VERCEL_GIT_COMMIT_REF: "unreviewed-feature" },
  ])("rejects a different deployment scope: %j", (change) => {
    expect(checkOcrDeploymentIsolation({ ...valid, ...change })).not.toEqual([]);
  });
  it.each(["DATABASE_URL", "DIRECT_URL", "PRODUCTION_DB_HOSTS", "OCR_EVAL_SHARED_DB_HOSTS", "OCR_EVAL_DB_IDENTITY"])("fails closed when %s is missing", (key) => {
    expect(checkOcrDeploymentIsolation({ ...valid, [key]: "" })).not.toEqual([]);
  });
  it.each(["ep-production-123", "ep-preview-456"])("rejects %s even if the expected identity is incorrectly set to it", (id) => {
    expect(checkOcrDeploymentIsolation({ ...valid, OCR_EVAL_DB_IDENTITY: id,
      DATABASE_URL: connection(`${id}-pooler`), DIRECT_URL: connection(id),
    }).join(" ")).toContain("separate");
  });
  it.each(["DATABASE_URL", "DIRECT_URL"])("rejects a different database in %s", (key) => {
    expect(checkOcrDeploymentIsolation({ ...valid, [key]: connection("ep-other-111") })).not.toEqual([]);
  });
  it("rejects multiple expected identities", () => {
    expect(checkOcrDeploymentIsolation({ ...valid, OCR_EVAL_DB_IDENTITY: "ep-ocr-789,ep-other-111" }).join(" ")).toContain("exactly one");
  });
  it("rejects a delimiter-only shared exclusion list even when the expected pin names the shared database", () => {
    expect(checkOcrDeploymentIsolation({ ...valid, OCR_EVAL_SHARED_DB_HOSTS: ", ,\t\n",
      OCR_EVAL_DB_IDENTITY: "ep-preview-456", DATABASE_URL: connection("ep-preview-456"),
      DIRECT_URL: connection("ep-preview-456"),
    }).join(" ")).toContain("at least one");
  });
  it("rejects non-Postgres connections and malformed configuration without disclosing credentials", () => {
    for (const value of ["not-a-url private-password", "https://test:private-password@ep-ocr-789.us-east-1.aws.neon.tech/"]) {
      const problems = checkOcrDeploymentIsolation({ ...valid, DATABASE_URL: value });
      expect(problems).not.toEqual([]);
      expect(problems.join(" ")).not.toContain("private-password");
    }
  });
  it("blocks query routing that overrides the URI host in the installed database driver", () => {
    const value = `${connection("ep-ocr-789")}?host=ep-production-123.us-east-1.aws.neon.tech`;
    expect(parse(value).host).toBe("ep-production-123.us-east-1.aws.neon.tech");
    expect(checkOcrDeploymentIsolation({ ...valid, DATABASE_URL: value }).join(" ")).toContain("unsupported connection options");
  });
  it.each(["port=5433", "hostaddr=127.0.0.1", "options=-c%20search_path%3Dother", "sslmode=disable", "sslmode=require&sslmode=disable"])("rejects unsupported DSN options: %s", (query) => {
    expect(checkOcrDeploymentIsolation({ ...valid, DIRECT_URL: `${valid.DIRECT_URL}?${query}` })).not.toEqual([]);
  });
  it("allows Neon TLS options without changing the checked endpoint", () => {
    expect(checkOcrDeploymentIsolation({ ...valid,
      DATABASE_URL: `${valid.DATABASE_URL}?sslmode=require&channel_binding=require`,
      DIRECT_URL: `${valid.DIRECT_URL}?sslmode=verify-full`,
    })).toEqual([]);
  });
});
