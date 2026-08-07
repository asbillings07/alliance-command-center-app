import { describe, expect, it, vi } from "vitest";
import { AllianceAllowlistError, validateAllianceAllowlist } from "./apsAuditAllowlist";
import { AuditUsageError } from "./apsAuditUsageError";
import type { AuditTxClient } from "./apsAuditTransaction";

function mockTx(resolvedIds: string[]): AuditTxClient {
  return {
    alliance: {
      findMany: vi.fn().mockResolvedValue(resolvedIds.map((id) => ({ id }))),
    },
  } as unknown as AuditTxClient;
}

describe("validateAllianceAllowlist", () => {
  it("rejects an empty allowlist without querying the database", async () => {
    const tx = mockTx([]);
    await expect(validateAllianceAllowlist(tx, [])).rejects.toThrow(AllianceAllowlistError);
    expect(tx.alliance.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("rejects a duplicate id without querying the database", async () => {
    const tx = mockTx(["a", "a"]);
    await expect(validateAllianceAllowlist(tx, ["a", "a"])).rejects.toThrow(/duplicate/i);
    expect(tx.alliance.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("never discloses the raw duplicate alliance id(s) in the error message, only the count", async () => {
    const tx = mockTx(["cln1secretallianceid", "cln1secretallianceid"]);
    try {
      await validateAllianceAllowlist(tx, ["cln1secretallianceid", "cln1secretallianceid"]);
      throw new Error("expected validateAllianceAllowlist to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("cln1secretallianceid");
      expect(message).toContain("1 duplicate alliance id");
    }
  });

  it("rejects an unknown id that does not resolve to a real alliance", async () => {
    const tx = mockTx(["a"]); // only "a" resolves
    await expect(validateAllianceAllowlist(tx, ["a", "unknown"])).rejects.toThrow(/did not resolve/i);
  });

  it("resolves successfully for a valid, non-empty, unique allowlist", async () => {
    const tx = mockTx(["a", "b"]);
    const resolved = await validateAllianceAllowlist(tx, ["a", "b"]);
    expect(new Set(resolved)).toEqual(new Set(["a", "b"]));
  });

  it("passes the exact allowlist to the transaction-scoped query, never the global client", async () => {
    const tx = mockTx(["a"]);
    await validateAllianceAllowlist(tx, ["a"]);
    expect(tx.alliance.findMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } }, select: { id: true } });
  });

  it("throws AllianceAllowlistError as an AuditUsageError, so the CLI entrypoint treats its message as safe to print", async () => {
    const tx = mockTx([]);
    await expect(validateAllianceAllowlist(tx, [])).rejects.toBeInstanceOf(AuditUsageError);
  });
});
