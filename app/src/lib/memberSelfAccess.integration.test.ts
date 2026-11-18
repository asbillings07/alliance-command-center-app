import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { loadIdentityReview, decideMemberIdentity } from "./memberIdentity";
import { loadMemberAccessReview, decideMemberSelfAccess, loadOwnMemberRecord, listOwnMemberRecords } from "./memberSelfAccess";
import { heldTransaction, expectStillBlocked } from "./metrics/testing/heldTransaction";

describe.skipIf(process.env.INTEGRATION_DB !== "true")("Member self access [integration]", () => {
  let db: PrismaClient;
  let allianceId: string, memberId: string, actorId: string, accountId: string;
  beforeAll(async () => { ({ prisma: db } = await import("./prisma")); });
  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    actorId = (await db.user.create({ data: { email: `access-owner-${suffix}@example.test`, displayName: "Morgan Owner" } })).id;
    accountId = (await db.user.create({ data: { email: `access-member-${suffix}@example.test`, displayName: "Jordan Account" } })).id;
    allianceId = (await db.alliance.create({ data: { name: `Access ${suffix}`, server: "956" } })).id;
    await db.allianceMembership.create({ data: { allianceId, userId: actorId, role: "OWNER" } });
    memberId = (await db.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: accountId, thp: 999 } })).id;
  });
  afterEach(async () => {
    await db.allianceMember.deleteMany({ where: { allianceId } });
    await db.allianceMembership.deleteMany({ where: { allianceId } });
    await db.alliance.deleteMany({ where: { id: allianceId } });
    await db.user.deleteMany({ where: { id: { in: [actorId, accountId] } } });
  });
  const review = () => loadMemberAccessReview(allianceId, memberId, actorId);
  const own = () => loadOwnMemberRecord(allianceId, accountId);
  async function identity(confirm = true) {
    return decideMemberIdentity({ allianceId, memberId, actorId, confirm, acknowledged: true,
      reviewKey: (await loadIdentityReview(allianceId, memberId, actorId)).reviewKey });
  }
  async function decide(grant = true, key?: string) {
    return decideMemberSelfAccess({ allianceId, memberId, actorId, grant, acknowledged: true, reviewKey: key ?? (await review()).reviewKey });
  }
  it("requires explicit approval after identity confirmation and returns only the member-safe projection", async () => {
    expect(await own()).toBeNull();
    await expect(decide()).rejects.toThrow("Confirm the current");
    await identity();
    expect(await own()).toBeNull();
    expect(await listOwnMemberRecords(accountId)).toEqual([]);
    await decide();
    const record = await own();
    expect(Object.keys(record!).sort()).toEqual(["allianceId", "allianceName", "playerName", "server"]);
    expect(record).toMatchObject({ allianceId, playerName: "Jordan Vale", server: "956" });
    expect(await listOwnMemberRecords(accountId)).toEqual([record]);
    expect(await db.allianceMembership.count({ where: { allianceId, userId: accountId } })).toBe(0);
    expect(await db.memberMetricEntry.count({ where: { allianceMemberId: memberId } })).toBe(0);
    expect(await loadOwnMemberRecord(allianceId, actorId)).toBeNull();
    expect(await loadOwnMemberRecord("other-alliance", accountId)).toBeNull();
  });
  it("denies Leaders, Viewers, ordinary members, cross-tenant and wrong-member requests; permits Admin", async () => {
    await identity();
    const key = (await review()).reviewKey;
    for (const role of ["LEADER", "VIEWER"] as const) {
      await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role } });
      await expect(review()).rejects.toThrow("permission");
      await expect(decide(true, key)).rejects.toThrow("permission");
    }
    await expect(loadMemberAccessReview(allianceId, memberId, accountId)).rejects.toThrow("permission");
    await expect(decideMemberSelfAccess({ allianceId, memberId, actorId: accountId, grant: true, acknowledged: true, reviewKey: key })).rejects.toThrow("permission");
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "ADMIN" } });
    await expect(loadMemberAccessReview("other", memberId, actorId)).rejects.toThrow("permission");
    await expect(loadMemberAccessReview(allianceId, "other", actorId)).rejects.toThrow("not found");
    await decide(true, key);
    expect((await review()).enabled).toBe(true);
  });
  it("requires acknowledgement, rejects stale/repeated decisions and retains immutable grant/revoke history", async () => {
    await identity(); const key = (await review()).reviewKey;
    await expect(decideMemberSelfAccess({ allianceId, memberId, actorId, grant: true, acknowledged: false, reviewKey: key })).rejects.toThrow("Confirm");
    const grant = await decide(true, key);
    await expect(decide(false, key)).rejects.toThrow("changed");
    await expect(decide()).rejects.toThrow("already approved");
    await decide(false);
    expect(await own()).toBeNull();
    expect((await review()).decisions.map(d => d.granted)).toEqual([false, true]);
    await expect(decide(false)).rejects.toThrow("no access approval");
    await expect(db.memberSelfAccessDecision.update({ where: { id: grant.id }, data: { granted: false } })).rejects.toThrow("immutable");
    await expect(db.memberSelfAccessDecision.delete({ where: { id: grant.id } })).rejects.toThrow("immutable");
  });
  it("identity revocation and later reconfirmation never silently restore access", async () => {
    await identity(); await decide();
    await identity(false); expect(await own()).toBeNull();
    await identity(); expect(await own()).toBeNull();
    await decide(); expect(await own()).not.toBeNull();
  });
  it("invalidates name, link, archive and alliance context round trips, but not unrelated stats", async () => {
    await identity(); await decide();
    await db.allianceMember.update({ where: { id: memberId }, data: { thp: 1000 } });
    expect(await own()).not.toBeNull();
    const changes = [
      async () => { await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Changed" } }); await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Jordan Vale" } }); },
      async () => { await db.allianceMember.update({ where: { id: memberId }, data: { userId: null } }); await db.allianceMember.update({ where: { id: memberId }, data: { userId: accountId } }); },
      async () => { await db.allianceMember.update({ where: { id: memberId }, data: { archivedAt: new Date() } }); await db.allianceMember.update({ where: { id: memberId }, data: { archivedAt: null } }); },
      async () => { await db.alliance.update({ where: { id: allianceId }, data: { server: "957" } }); await db.alliance.update({ where: { id: allianceId }, data: { server: "956" } }); },
      async () => { const old = (await db.alliance.findUniqueOrThrow({ where: { id: allianceId } })).name; await db.alliance.update({ where: { id: allianceId }, data: { name: "Changed" } }); await db.alliance.update({ where: { id: allianceId }, data: { name: old } }); },
    ];
    for (const change of changes) {
      await change(); expect(await own()).toBeNull();
      await identity(); expect(await own()).toBeNull();
      await decide(); expect(await own()).not.toBeNull();
    }
  });
  it("denies ambiguous account links including archived records", async () => {
    await identity(); await decide();
    await db.allianceMember.create({ data: { allianceId, playerName: "Archived duplicate", userId: accountId, archivedAt: new Date() } });
    expect(await own()).toBeNull(); expect(await listOwnMemberRecords(accountId)).toEqual([]);
  });
  it("revokes the old grantee after relinking, without reducing collaborator permissions", async () => {
    await identity(); const grant = await decide();
    await db.allianceMembership.create({ data: { allianceId, userId: accountId, role: "VIEWER" } });
    expect((await review()).collaboratorRole).toBe("VIEWER");
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: actorId } });
    expect(await own()).toBeNull();
    const revoke = await decide(false);
    expect(revoke).toMatchObject({ accountUserId: accountId, identityDecisionId: grant.identityDecisionId, accountName: "Jordan Account" });
    expect(await db.allianceMembership.findUnique({ where: { allianceId_userId: { allianceId, userId: accountId } } })).toMatchObject({ role: "VIEWER" });
  });
  it("admits exactly one concurrent grant and one concurrent revocation", async () => {
    await identity();
    for (const grant of [true, false]) {
      const key = (await review()).reviewKey;
      const results = await Promise.allSettled([decide(grant, key), decide(grant, key)]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    }
    expect((await review()).decisions).toHaveLength(2); expect(await own()).toBeNull();
  });
  it("rejects a manager demoted while an access grant waits", async () => {
    await identity(); const key = (await review()).reviewKey;
    const hold = heldTransaction(db, tx => tx.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "LEADER" } }));
    await hold.ready;
    const result = decide(true, key).then(() => "accepted", () => "rejected");
    try { await expectStillBlocked(result, 100); } finally { hold.commit(); await hold.committed; }
    expect(await result).toBe("rejected");
    expect(await db.memberSelfAccessDecision.count({ where: { memberId } })).toBe(0);
  });
  it("preserves historical attribution after account/profile/member deletion", async () => {
    await identity(); const grant = await decide();
    await db.user.update({ where: { id: actorId }, data: { displayName: "Changed" } });
    await db.allianceMember.delete({ where: { id: memberId } });
    await db.user.delete({ where: { id: accountId } });
    expect(await own()).toBeNull();
    expect(await db.memberSelfAccessDecision.findUnique({ where: { id: grant.id } })).toMatchObject({ actorName: "Morgan Owner", accountName: "Jordan Account", playerName: "Jordan Vale" });
  });
});
