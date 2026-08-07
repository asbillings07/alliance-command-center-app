import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Executable evidence (#284 PR A review) that
 * `scripts/show-aps-audit-target-identity.ts` -- the operator-local identity
 * lookup that replaces the audit CLI's `--show-target-identity` flag -- (a)
 * never prints the identity to stdout/stderr, and (b) never constructs or
 * connects a database client, even when `DATABASE_URL` points at an
 * unroutable host that would hang or error on a real connection attempt.
 */

const SCRIPT_PATH = join(process.cwd(), "scripts", "show-aps-audit-target-identity.ts");
const FAKE_DATABASE_URL = "postgresql://u:p@ep-test-only-000000-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
const EXPECTED_IDENTITY = "ep-test-only-000000";

function cleanupWrittenFiles(): void {
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith("aps-audit-target-identity-") && name.endsWith(".local")) {
      rmSync(join(tmpdir(), name), { force: true });
    }
  }
}

describe("show-aps-audit-target-identity.ts", () => {
  it("never imports the Prisma client or any Prisma-backed module -- a structural, not just behavioral, guarantee", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const importSpecifiers = [...source.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(importSpecifiers.length).toBeGreaterThan(0);
    for (const specifier of importSpecifiers) {
      expect(specifier.toLowerCase()).not.toContain("prisma");
      expect(specifier).not.toContain("apsAuditCli");
      expect(specifier).not.toContain("apsDataReadinessAudit");
    }
  });

  it("the identity-file-writer module it depends on is equally Prisma-free (Node builtins only)", () => {
    const writerPath = join(process.cwd(), "app", "src", "lib", "operations", "apsAuditIdentityFileWriter.ts");
    const source = readFileSync(writerPath, "utf8");
    const importSpecifiers = [...source.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(importSpecifiers.length).toBeGreaterThan(0);
    for (const specifier of importSpecifiers) {
      expect(specifier.toLowerCase()).not.toContain("prisma");
      expect(specifier.startsWith("node:")).toBe(true);
    }
  });

  it("writes the identity to a local file and prints only the file path -- never the identity -- to EITHER stdout or stderr, even against an unroutable host (proving no connection attempt)", () => {
    cleanupWrittenFiles();
    try {
      // spawnSync (not execFileSync, which only returns stdout and would
      // silently miss a regression that wrote the identity to stderr
      // instead) captures both streams explicitly.
      const result = spawnSync("npx", ["tsx", SCRIPT_PATH], {
        env: { ...process.env, DATABASE_URL: FAKE_DATABASE_URL },
        encoding: "utf8",
        // Generous for `npx tsx` cold-start, but far short of what a real
        // (even failing) DNS/connection attempt against an unroutable Neon
        // hostname would take -- a hang or timeout here would itself be
        // evidence this script tried to connect to a database.
        timeout: 15_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);

      const { stdout, stderr } = result;
      expect(stdout).not.toContain(EXPECTED_IDENTITY);
      expect(stderr).not.toContain(EXPECTED_IDENTITY);
      expect(stderr).not.toContain(FAKE_DATABASE_URL);
      expect(stdout).not.toContain(FAKE_DATABASE_URL);
      // Nothing at all on stderr on a successful run -- any diagnostic
      // output there would itself be worth scrutinizing for a leak.
      expect(stderr.trim()).toBe("");

      const pathMatch = stdout.match(/local file \(not printed here\): (\S+)/);
      expect(pathMatch).not.toBeNull();
      const writtenPath = pathMatch![1]!;
      expect(existsSync(writtenPath)).toBe(true);

      const contents = readFileSync(writtenPath, "utf8").trim();
      expect(contents).toBe(EXPECTED_IDENTITY);
    } finally {
      cleanupWrittenFiles();
    }
  });
});
