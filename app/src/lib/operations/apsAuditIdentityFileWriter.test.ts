import { symlinkSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeIdentityToLocalFile } from "./apsAuditIdentityFileWriter";

/**
 * Regression coverage for a real Copilot review finding on #284 PR A: a
 * predictable-enough filename written with a non-exclusive `writeFileSync`
 * on a shared temp directory can be abused via a planted symlink to
 * overwrite (or exfiltrate through) an arbitrary file the process can
 * write to. These tests force the exact collision scenario deterministically
 * (via a fixed `randomSuffix`) rather than relying on randomness to avoid
 * it, and prove the write fails closed instead of following the symlink.
 */
describe("writeIdentityToLocalFile", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes the identity to a new, mode-0600 file and returns its path", () => {
    dir = mkdtempSync(join(tmpdir(), "aps-identity-writer-test-"));
    const path = writeIdentityToLocalFile("ep-cool-name-123456", { tmpDir: dir, randomSuffix: "abc123" });

    expect(readFileSync(path, "utf8")).toBe("ep-cool-name-123456\n");
    // 0o600 masked to the permission bits vitest/CI's umask can't touch.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("REFUSES to follow a pre-existing symlink at the computed path -- proving the symlink-attack finding is closed", () => {
    dir = mkdtempSync(join(tmpdir(), "aps-identity-writer-test-"));
    const secretTarget = join(dir, "victim-file.txt");
    writeFileSync(secretTarget, "do-not-touch");

    // Simulate an attacker who predicted (or sprayed) the exact filename
    // this call will compute, and planted a symlink there ahead of time.
    const suffix = "predictable-suffix";
    const attackPath = join(dir, `aps-audit-target-identity-${suffix}.local`);
    symlinkSync(secretTarget, attackPath);

    expect(() => writeIdentityToLocalFile("ep-cool-name-123456", { tmpDir: dir, randomSuffix: suffix })).toThrow(
      /EEXIST/,
    );

    // The symlink's target must be completely untouched -- neither
    // overwritten with the identity nor read/exfiltrated.
    expect(readFileSync(secretTarget, "utf8")).toBe("do-not-touch");
  });

  it("REFUSES to overwrite a pre-existing regular file at the computed path", () => {
    dir = mkdtempSync(join(tmpdir(), "aps-identity-writer-test-"));
    const suffix = "already-taken";
    const existingPath = join(dir, `aps-audit-target-identity-${suffix}.local`);
    writeFileSync(existingPath, "pre-existing-content");

    expect(() => writeIdentityToLocalFile("ep-cool-name-123456", { tmpDir: dir, randomSuffix: suffix })).toThrow(
      /EEXIST/,
    );
    expect(readFileSync(existingPath, "utf8")).toBe("pre-existing-content");
  });

  it("uses 128 bits of randomness by default (32 hex characters), not a smaller, easier-to-spray value", () => {
    dir = mkdtempSync(join(tmpdir(), "aps-identity-writer-test-"));
    const path = writeIdentityToLocalFile("ep-cool-name-123456", { tmpDir: dir });
    const match = path.match(/aps-audit-target-identity-([0-9a-f]+)\.local$/);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(32);
  });
});
