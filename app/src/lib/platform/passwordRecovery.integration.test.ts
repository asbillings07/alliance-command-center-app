import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient, Prisma, User } from "@/app/generated/prisma/client";
import type * as Recovery from "./passwordRecovery";
import type * as Reset from "../passwordReset";
import type * as Account from "../account";
import { heldTransaction, expectStillBlocked } from "../metrics/testing/heldTransaction";

const runDb = process.env.INTEGRATION_DB === "true";
describe.skipIf(!runDb)("operator password recovery [integration]", () => {
  let prisma: PrismaClient;
  let recovery: typeof Recovery;
  let reset: typeof Reset;
  let account: typeof Account;
  let hash: string;
  const ids: string[] = [];
  const password = "operator-passphrase";
  beforeAll(async () => {
    ({ prisma } = await import("../prisma"));
    recovery = await import("./passwordRecovery");
    reset = await import("../passwordReset");
    account = await import("../account");
    hash = await (await import("bcrypt")).default.hash(password, 4);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.passwordRecoveryEvent.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    ids.length = 0;
  });
  async function user(data: Partial<User> = {}) {
    const u = await prisma.user.create({ data: {
      email: `recovery-${crypto.randomUUID()}@example.test`, displayName: "Recovery Tester", passwordHash: hash, ...data,
    } });
    ids.push(u.id); return u;
  }
  const input = (target: User) => ({ targetUserId: target.id, expectedEmail: target.email, operatorPassword: password, identityConfirmed: true });

  it("integration: issues a private audited link, preserves password until used, then revokes sessions and rejects reuse", async () => {
    const actor = await user({ isPlatformAdmin: true, displayName: "Support Operator" });
    const target = await user();
    const old = await reset.createPasswordResetToken(target.id);
    await prisma.passwordResetToken.updateMany({ where: { userId: target.id }, data: { createdAt: new Date(Date.now() - 120000) } });
    const issued = await recovery.issueAssistedPasswordReset(actor.id, input(target));
    if (!issued.ok || !old.created) throw new Error("expected links");
    expect(issued.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60000);
    expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60000);
    expect(await reset.isValidPasswordResetToken(old.rawToken)).toBe(false);
    expect(await reset.isValidPasswordResetToken(issued.rawToken)).toBe(true);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.passwordHash).toBe(hash);
    expect(unchanged.sessionVersion).toBe(0);
    const event = await prisma.passwordRecoveryEvent.findFirstOrThrow({ where: { targetUserId: target.id } });
    expect(event).toMatchObject({ actorUserId: actor.id, actorName: "Support Operator", targetUserId: target.id, targetEmail: target.email });
    expect(JSON.stringify(event)).not.toContain(issued.rawToken);
    expect(JSON.stringify(event)).not.toContain(password);
    expect(JSON.stringify(event)).not.toContain(hash);
    const read = await recovery.getPasswordRecoveryAccount({ userId: target.id });
    expect(read).toMatchObject({ hasPassword: true, id: target.id });
    expect(read).not.toHaveProperty("passwordHash");
    expect(await reset.resetPassword(issued.rawToken, "new-owner-passphrase")).toEqual({ status: "success" });
    expect(await account.verifyPassword(target.id, "new-owner-passphrase")).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).sessionVersion).toBe(1);
    expect(await reset.resetPassword(issued.rawToken, "another-passphrase")).toEqual({ status: "invalid_token" });
    await expect(prisma.passwordRecoveryEvent.update({ where: { id: event.id }, data: { actorName: "Changed" } })).rejects.toThrow("immutable");
    await prisma.user.delete({ where: { id: target.id } });
    expect(await prisma.passwordRecoveryEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
  });

  it.each(["not_admin", "wrong_password", "unconfirmed", "wrong_email", "google_only", "admin_target", "no_operator_password", "long_password"])("integration: rejects %s without token or audit writes", async (kind) => {
    const actor = await user({ isPlatformAdmin: kind !== "not_admin", passwordHash: kind === "no_operator_password" ? null : hash });
    const target = await user({ passwordHash: kind === "google_only" ? null : hash, isPlatformAdmin: kind === "admin_target" });
    const request = input(target);
    if (kind === "wrong_password") request.operatorPassword = "incorrect-password";
    if (kind === "long_password") request.operatorPassword = "x".repeat(73);
    if (kind === "unconfirmed") request.identityConfirmed = false;
    if (kind === "wrong_email") request.expectedEmail = "wrong@example.test";
    expect((await recovery.issueAssistedPasswordReset(actor.id, request)).ok).toBe(false);
    expect(await prisma.passwordResetToken.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.passwordRecoveryEvent.count({ where: { targetUserId: target.id } })).toBe(0);
  });

  it("integration: concurrent requests produce one link and one audit record, with bounded reissue", async () => {
    const actor = await user({ isPlatformAdmin: true }); const target = await user();
    const results = await Promise.all([recovery.issueAssistedPasswordReset(actor.id, input(target)), recovery.issueAssistedPasswordReset(actor.id, input(target))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.passwordResetToken.count({ where: { userId: target.id, usedAt: null } })).toBe(1);
    expect(await prisma.passwordRecoveryEvent.count({ where: { targetUserId: target.id } })).toBe(1);
  });

  it("integration: a failed audit write rolls back issuance and leaves the prior link usable", async () => {
    const actor = await user({ isPlatformAdmin: true }); const target = await user();
    const old = await reset.createPasswordResetToken(target.id);
    if (!old.created) throw new Error("expected old link");
    await prisma.passwordResetToken.updateMany({ where: { userId: target.id }, data: { createdAt: new Date(Date.now() - 120000) } });
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => {
      const wrapped = Object.create(tx) as Prisma.TransactionClient;
      Object.defineProperty(wrapped, "passwordRecoveryEvent", { value: { ...tx.passwordRecoveryEvent, create: async () => { throw new Error("AUDIT_WRITE_FAILED"); } } });
      return fn(wrapped);
    })) as typeof prisma.$transaction);
    await expect(recovery.issueAssistedPasswordReset(actor.id, input(target))).rejects.toThrow("AUDIT_WRITE_FAILED");
    expect(await reset.isValidPasswordResetToken(old.rawToken)).toBe(true);
    expect(await prisma.passwordRecoveryEvent.count({ where: { targetUserId: target.id } })).toBe(0);
  });

  it("integration: a role revoked after password verification cannot issue a link", async () => {
    const actor = await user({ isPlatformAdmin: true }); const target = await user();
    const verify = account.verifyPassword;
    vi.spyOn(account, "verifyPassword").mockImplementation(async (id, pass) => {
      const verified = await verify(id, pass);
      await prisma.user.update({ where: { id }, data: { isPlatformAdmin: false } });
      return verified;
    });
    expect((await recovery.issueAssistedPasswordReset(actor.id, input(target))).ok).toBe(false);
    expect(await prisma.passwordResetToken.count({ where: { userId: target.id } })).toBe(0);
  });
  it.each(["consume", "self_service_issue"])("integration: assisted issuance and %s use the same lock order", async (operation) => {
    const actor = await user({ isPlatformAdmin: true }); const target = await user();
    const old = await reset.createPasswordResetToken(target.id);
    if (!old.created) throw new Error("expected old link");
    await prisma.passwordResetToken.updateMany({ where: { userId: target.id }, data: { createdAt: new Date(Date.now() - 120000) } });
    let entered!: () => void;
    let release!: () => void;
    const atWrite = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const write = reset.createPasswordResetTokenInTransaction;
    vi.spyOn(reset, "createPasswordResetTokenInTransaction").mockImplementation(async (...args) => {
      entered(); await gate; return write(...args);
    });
    const assist = recovery.issueAssistedPasswordReset(actor.id, input(target));
    await atWrite; // Assisted transaction holds User but has not touched tokens.
    const competing = operation === "consume"
      ? reset.resetPassword(old.rawToken, "concurrent-owner-password")
      : reset.createPasswordResetToken(target.id);
    // Allow the second connection to reach its contested lock (including bcrypt).
    let settled = false;
    void competing.then(() => { settled = true; }, () => { settled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(settled).toBe(false);
    } finally { release(); }
    const [issued, other] = await Promise.all([assist, competing]);
    expect(issued.ok).toBe(true);
    if (operation === "consume") expect(other).toEqual({ status: "invalid_token" });
    else expect(other).toMatchObject({ created: true });
    expect(await prisma.passwordResetToken.count({ where: { userId: target.id, usedAt: null } })).toBe(1);
    expect(await prisma.passwordRecoveryEvent.count({ where: { targetUserId: target.id } })).toBe(1);
  });

  it("integration: overlapping public requests coalesce while the first waits for User", async () => {
    const target = await user();
    const hold = heldTransaction(prisma, (tx) => tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${target.id} FOR UPDATE`);
    await hold.ready;
    const first = reset.createPasswordResetToken(target.id);
    try {
      await expectStillBlocked(first);
      expect(await reset.createPasswordResetToken(target.id)).toEqual({ created: false });
    } finally { hold.commit(); await hold.committed; }
    expect(await first).toMatchObject({ created: true });
    expect(await prisma.passwordResetToken.count({ where: { userId: target.id, usedAt: null } })).toBe(1);
  });

  it("integration: a token that expires while waiting for User cannot reset a password", async () => {
    const target = await user();
    const issued = await reset.createPasswordResetToken(target.id);
    if (!issued.created) throw new Error("expected link");
    const expiresAt = new Date(Date.now() + 1800);
    await prisma.passwordResetToken.updateMany({ where: { userId: target.id }, data: { expiresAt } });
    const hold = heldTransaction(prisma, (tx) => tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${target.id} FOR UPDATE`);
    await hold.ready;
    const consume = reset.resetPassword(issued.rawToken, "must-not-be-saved");
    try {
      await expectStillBlocked(consume);
      expect(Date.now()).toBeLessThan(expiresAt.getTime());
      await new Promise((resolve) => setTimeout(resolve, expiresAt.getTime() - Date.now() + 50));
    } finally { hold.commit(); await hold.committed; }
    expect(await consume).toEqual({ status: "invalid_token" });
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.passwordHash).toBe(hash);
    expect(unchanged.sessionVersion).toBe(0);
  });

});
