import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { loadIdentityReview, decideMemberIdentity } from "./memberIdentity";
import { heldTransaction, expectStillBlocked } from "./metrics/testing/heldTransaction";

describe.skipIf(process.env.INTEGRATION_DB !== "true")("Member identity decisions [integration]", () => {
  let db: PrismaClient;
  let allianceId: string, memberId: string, actorId: string, accountId: string;
  beforeAll(async () => { ({ prisma: db } = await import("./prisma")); });
  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    actorId = (await db.user.create({ data: { email: `identity-owner-${suffix}@example.test`, displayName: "Morgan Leader" } })).id;
    accountId = (await db.user.create({ data: { email: `identity-member-${suffix}@example.test`, displayName: "Jordan Member" } })).id;
    allianceId = (await db.alliance.create({ data: { name: `Identity ${suffix}`, server: "956" } })).id;
    await db.allianceMembership.create({ data: { allianceId, userId: actorId, role: "OWNER" } });
    memberId = (await db.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: accountId } })).id;
  });
  afterEach(async () => {
    await db.allianceMember.deleteMany({ where: { allianceId } });
    await db.allianceMembership.deleteMany({ where: { allianceId } });
    await db.alliance.deleteMany({ where: { id: allianceId } });
    await db.user.deleteMany({ where: { id: { in: [actorId, accountId] } } });
    // Audit snapshots intentionally survive this removal; no mutable FKs.
  });
  const load = () => loadIdentityReview(allianceId, memberId, actorId);
  async function decide(confirm = true, reviewKey?: string) {
    return decideMemberIdentity({ allianceId, memberId, actorId, confirm, acknowledged: true, reviewKey: reviewKey ?? (await load()).reviewKey });
  }
  it("does not grandfather legacy links; confirms, persists and revokes without granting access", async () => {
    expect(await load()).toMatchObject({ confirmed: false, missing: [], decisions: [] });
    await decide();
    expect(await load()).toMatchObject({ confirmed: true, decisions: [{ actorUserId: actorId, actorName: "Morgan Leader", actorRole: "OWNER", accountUserId: accountId }] });
    expect(await db.allianceMembership.count({ where: { allianceId, userId: accountId } })).toBe(0);
    await decide(false);
    const after = await load();
    expect(after.confirmed).toBe(false);
    expect(after.decisions.map((d) => d.confirmed)).toEqual([false, true]);
    expect(await db.memberMetricEntry.count({ where: { allianceMemberId: memberId } })).toBe(0);
  });
  it("requires deliberate acknowledgement and an existing unambiguous account", async () => {
    await expect(decideMemberIdentity({ allianceId, memberId, actorId, reviewKey: (await load()).reviewKey, confirm: true, acknowledged: false })).rejects.toThrow("Confirm");
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: null } });
    await expect(decide()).rejects.toThrow("No account");
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: accountId } });
    await db.allianceMember.create({ data: { allianceId, playerName: "Another member", userId: accountId } });
    await expect(decide()).rejects.toThrow("more than one");
    expect(await db.memberIdentityDecision.count({ where: { memberId } })).toBe(0);
  });
  it("requires current name, alliance and server", async () => {
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: " " } });
    await expect(decide()).rejects.toThrow("in-game name");
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Jordan Vale" } });
    await db.alliance.update({ where: { id: allianceId }, data: { server: " " } });
    await expect(decide()).rejects.toThrow("Alliance and server");
    await db.alliance.update({ where: { id: allianceId }, data: { server: "956", name: " " } });
    await expect(decide()).rejects.toThrow("Alliance and server");
  });
  it("denies Viewer, Leader, ordinary member and cross-tenant reads/writes; permits Admin", async () => {
    const key = (await load()).reviewKey;
    for (const role of ["VIEWER", "LEADER"] as const) {
      await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role } });
      await expect(load()).rejects.toThrow("permission");
      await expect(decide(true, key)).rejects.toThrow("permission");
    }
    await expect(loadIdentityReview(allianceId, memberId, accountId)).rejects.toThrow("permission");
    await expect(decideMemberIdentity({ allianceId: "other-alliance", memberId, actorId, reviewKey: key, acknowledged: true, confirm: true })).rejects.toThrow("permission");
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "ADMIN" } });
    await expect(loadIdentityReview(allianceId, "wrong-member", actorId)).rejects.toThrow("not found");
    await decide(true, key);
    expect((await load()).confirmed).toBe(true);
  });
  it("rejects stale and repeated decisions without erasing originals", async () => {
    const oldKey = (await load()).reviewKey;
    await decide(true, oldKey);
    await expect(decide(false, oldKey)).rejects.toThrow("changed");
    await expect(decide(true, oldKey)).rejects.toThrow("changed");
    await expect(decide()).rejects.toThrow("already confirmed");
    const current = (await load()).decisions[0];
    await expect(db.memberIdentityDecision.update({ where: { id: current.id }, data: { confirmed: false } })).rejects.toThrow("immutable");
    await expect(db.memberIdentityDecision.delete({ where: { id: current.id } })).rejects.toThrow("immutable");
    expect((await load()).decisions).toHaveLength(1);
  });
  it("invalidates renamed and relinked identities even after changing back", async () => {
    await decide();
    const oldKey = (await load()).reviewKey;
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Other name" } });
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Jordan Vale", identityVersion: 0 } });
    expect((await load()).confirmed).toBe(false);
    await expect(decide(true, oldKey)).rejects.toThrow("changed");
    await decide();
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: null } });
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: accountId } });
    expect((await load()).confirmed).toBe(false);
  });
  it("invalidates archived/restored members and server/name changes without affecting metric/property edits", async () => {
    await decide();
    await db.allianceMember.update({ where: { id: memberId }, data: { thp: 500, squadPower: 20 } });
    expect((await load()).confirmed).toBe(true);
    await db.allianceMember.update({ where: { id: memberId }, data: { archivedAt: new Date() } });
    await expect(decide()).rejects.toThrow("archived");
    await db.allianceMember.update({ where: { id: memberId }, data: { archivedAt: null } });
    expect((await load()).confirmed).toBe(false);
    await decide();
    await db.alliance.update({ where: { id: allianceId }, data: { server: "957" } });
    await db.alliance.update({ where: { id: allianceId }, data: { server: "956", identityVersion: 0 } });
    expect((await load()).confirmed).toBe(false);
    await decide();
    await db.alliance.update({ where: { id: allianceId }, data: { name: "Renamed alliance" } });
    expect((await load()).confirmed).toBe(false);
  });
  it("admits only one concurrent confirmation for the same reviewed state", async () => {
    const key = (await load()).reviewKey;
    const results = await Promise.allSettled([decide(true, key), decide(true, key)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.memberIdentityDecision.count({ where: { memberId } })).toBe(1);
  });
  it("rejects role revocation while admission waits", async () => {
    const key = (await load()).reviewKey;
    const hold = heldTransaction(db, (tx) => tx.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } }));
    await hold.ready;
    const result = decide(true, key).then(() => "accepted", () => "rejected");
    try { await expectStillBlocked(result, 100); }
    finally { hold.commit(); await hold.committed; }
    expect(await result).toBe("rejected");
    expect(await db.memberIdentityDecision.count({ where: { memberId } })).toBe(0);
  });
  it("retains historical actor and context after profile changes and member/account removal", async () => {
    const event = await decide();
    await db.user.update({ where: { id: actorId }, data: { displayName: "New name" } });
    await db.allianceMember.delete({ where: { id: memberId } });
    await db.user.delete({ where: { id: accountId } });
    expect(await db.memberIdentityDecision.findUnique({ where: { id: event.id } })).toMatchObject({ actorName: "Morgan Leader", playerName: "Jordan Vale", accountUserId: accountId });
  });
});
