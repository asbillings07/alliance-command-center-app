import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { metricEntryProvenance } from "./metricEntryProvenance";
import { loadMemberMetricHistory, HISTORY_PAGE_SIZE } from "./memberMetricHistory";
import { memberPeriodMetricValues } from "./memberPeriodMetricValues";
import { heldTransaction, expectStillBlocked } from "./testing/heldTransaction";
import { buildPermissionSet, hasPermission, Permissions } from "@/app/src/lib/auth/permissions";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({ requireAllianceAccess: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

const runDb = process.env.INTEGRATION_DB === "true";
describe.skipIf(!runDb)("Metric entry provenance and scoped history [integration]", () => {
  let prisma: PrismaClient;
  let actorId: string;
  const alliances: string[] = [];

  beforeAll(async () => { ({ prisma } = await import("@/app/src/lib/prisma")); });
  beforeEach(async () => {
    const actor = await prisma.user.create({ data: {
      email: `history-${crypto.randomUUID()}@example.test`, displayName: "Maya Chen",
    } });
    actorId = actor.id;
    vi.mocked(requireAllianceAccess).mockImplementation(async ({ allianceId, requiredPermission }) => {
      const membership = await prisma.allianceMembership.findUnique({ where: { allianceId_userId: { allianceId, userId: actorId } } });
      if (!membership || !hasPermission(buildPermissionSet(membership.role), requiredPermission ?? Permissions.VIEW_ALLIANCE)) throw new Error("ACCESS_DENIED");
      return { user: { id: actorId, email: actor.email }, membership, permissions: buildPermissionSet(membership.role) };
    });
  });
  afterEach(async () => {
    await prisma.memberMetricEntry.deleteMany({ where: { allianceMember: { allianceId: { in: alliances } } } });
    await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: alliances } } } });
    await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: alliances } } });
    await prisma.metric.deleteMany({ where: { allianceId: { in: alliances } } });
    await prisma.allianceMember.deleteMany({ where: { allianceId: { in: alliances } } });
    await prisma.allianceMembership.deleteMany({ where: { allianceId: { in: alliances } } });
    await prisma.alliance.deleteMany({ where: { id: { in: alliances } } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    alliances.length = 0;
    vi.clearAllMocks();
  });
  async function setup() {
    const alliance = await prisma.alliance.create({ data: { name: `History ${crypto.randomUUID()}`, server: "999" } });
    alliances.push(alliance.id);
    const membership = await prisma.allianceMembership.create({ data: { allianceId: alliance.id, userId: actorId, role: "LEADER" } });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Jordan Vale" } });
    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance.id, name: "November week" } });
    const metric = await prisma.metric.create({ data: { allianceId: alliance.id, name: "VS score", type: "NUMERIC", unitLabel: "points" } });
    await prisma.metricPeriodMetric.create({ data: { metricId: metric.id, periodId: period.id, weight: 1, required: false } });
    return { alliance, membership, member, period, metric,
      scope: { allianceId: alliance.id, memberId: member.id },
      data: { allianceMemberId: member.id, metricId: metric.id, periodId: period.id, value: 23340000 },
    };
  }

  it("preserves original actor and role after rename, demotion and account removal, without changing canonical scores", async () => {
    const s = await setup();
    const original = await prisma.memberMetricEntry.create({ data: { ...s.data, recordedAt: new Date("2026-11-10T12:00:00Z") } });
    const entered = await prisma.$transaction(async (tx) => tx.memberMetricEntry.create({ data: {
      ...s.data, value: 27400000, ...await metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL"),
    } }));
    await prisma.user.update({ where: { id: actorId }, data: { displayName: "Changed name" } });
    await prisma.allianceMembership.update({ where: { id: s.membership.id }, data: { role: "VIEWER" } });
    const history = await loadMemberMetricHistory(s.scope);
    expect(history.entries.map((e) => e.id)).toEqual([entered.id, original.id]);
    expect(history.selected).toMatchObject({ enteredByName: "Maya Chen", enteredByRole: "LEADER", entryMethod: "MANUAL", value: 27400000 });
    expect(history.entries[1]).toMatchObject({ enteredByName: null, enteredByRole: null, entryMethod: null });
    const before = await memberPeriodMetricValues(s.alliance.id, s.period.id, [s.metric.id]);
    await loadMemberMetricHistory({ ...s.scope, entryId: original.id });
    expect(await memberPeriodMetricValues(s.alliance.id, s.period.id, [s.metric.id])).toEqual(before);
    await prisma.allianceMembership.delete({ where: { id: s.membership.id } });
    await prisma.user.delete({ where: { id: actorId } });
    expect(await prisma.memberMetricEntry.findUnique({ where: { id: entered.id } })).toMatchObject({ enteredByUserId: actorId, enteredByName: "Maya Chen", enteredByRole: "LEADER" });
    // No history-access grant survives the removed membership.
    await expect(loadMemberMetricHistory(s.scope)).rejects.toThrow("ACCESS_DENIED");
  });

  it("rejects partial attribution, including null members of the known tuple; protects attribution from updates", async () => {
    const s = await setup();
    await expect(prisma.memberMetricEntry.create({ data: { ...s.data, enteredByUserId: actorId } })).rejects.toThrow();
    await expect(prisma.memberMetricEntry.create({ data: { ...s.data, enteredByName: "", enteredByUserId: actorId, enteredByRole: "LEADER", entryMethod: "MANUAL" } })).rejects.toThrow();
    const entry = await prisma.$transaction(async (tx) => tx.memberMetricEntry.create({ data: { ...s.data, ...await metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL") } }));
    await expect(prisma.memberMetricEntry.update({ where: { id: entry.id }, data: { enteredByName: "Someone else" } })).rejects.toThrow(/immutable after insert/i);
  });

  it("refuses a revoked or cross-alliance writer and rechecks additional permissions", async () => {
    const s = await setup();
    await prisma.allianceMembership.update({ where: { id: s.membership.id }, data: { role: "VIEWER" } });
    await expect(prisma.$transaction((tx) => metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL"))).rejects.toThrow("permission");
    await expect(prisma.$transaction((tx) => metricEntryProvenance(tx, "other-alliance", actorId, "MANUAL"))).rejects.toThrow("permission");
    await prisma.allianceMembership.update({ where: { id: s.membership.id }, data: { role: "LEADER" } });
    await expect(prisma.$transaction((tx) => metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL", [Permissions.MANAGE_ALLIANCE]))).rejects.toThrow("permission");
    expect(await prisma.memberMetricEntry.count({ where: { allianceMemberId: s.member.id } })).toBe(0);
  });

  it("holds actor and membership stable until the metric write commits", async () => {
    const s = await setup();
    const held = heldTransaction(prisma, async (tx) => {
      const provenance = await metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL");
      return tx.memberMetricEntry.create({ data: { ...s.data, ...provenance } });
    });
    const entry = await held.ready;
    const rename = prisma.user.update({ where: { id: actorId }, data: { displayName: "Renamed" } }).then((row) => row);
    const demote = prisma.allianceMembership.update({ where: { id: s.membership.id }, data: { role: "VIEWER" } }).then((row) => row);
    try { await Promise.all([expectStillBlocked(rename), expectStillBlocked(demote)]); }
    finally { held.commit(); await held.committed; await Promise.all([rename, demote]); }
    expect(await prisma.memberMetricEntry.findUnique({ where: { id: entry.id } })).toMatchObject({ enteredByName: "Maya Chen", enteredByRole: "LEADER" });
    await expect(prisma.$transaction((tx) => metricEntryProvenance(tx, s.alliance.id, actorId, "MANUAL"))).rejects.toThrow("permission");
  });

  it("paginates tied timestamps exactly once and does not shift older pages after a new insert", async () => {
    const s = await setup();
    const at = new Date("2026-11-10T12:00:00Z");
    await prisma.memberMetricEntry.createMany({ data: Array.from({ length: HISTORY_PAGE_SIZE + 5 }, (_, i) => ({
      ...s.data, id: `history-${s.member.id}-${i.toString().padStart(3, "0")}`, value: i, recordedAt: at, createdAt: at,
    })) });
    const first = await loadMemberMetricHistory(s.scope);
    expect(first.entries).toHaveLength(HISTORY_PAGE_SIZE);
    expect(first.selected?.value).toBe(29);
    await prisma.memberMetricEntry.create({ data: { ...s.data, value: 999 } });
    const second = await loadMemberMetricHistory({ ...s.scope, before: first.nextBefore! });
    expect(second.entries.map((e) => e.value)).toEqual([4, 3, 2, 1, 0]);
    expect(second.nextBefore).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(30);
  });

  it("scopes selected records, pagination and metric filters to this alliance and member", async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await prisma.memberMetricEntry.create({ data: b.data });
    const own = await prisma.memberMetricEntry.create({ data: a.data });
    const secondMember = await prisma.allianceMember.create({ data: { allianceId: a.alliance.id, playerName: "Other member" } });
    const other = await prisma.memberMetricEntry.create({ data: { ...a.data, allianceMemberId: secondMember.id } });
    for (const id of [foreign.id, other.id]) {
      await expect(loadMemberMetricHistory({ ...a.scope, entryId: id })).rejects.toThrow("NOT_FOUND");
      await expect(loadMemberMetricHistory({ ...a.scope, before: id })).rejects.toThrow("NOT_FOUND");
    }
    await expect(loadMemberMetricHistory({ ...a.scope, metricId: b.metric.id })).rejects.toThrow("NOT_FOUND");
    await expect(loadMemberMetricHistory({ ...a.scope, memberId: b.member.id })).rejects.toThrow("NOT_FOUND");
    expect((await loadMemberMetricHistory(a.scope)).entries.map((e) => e.id)).toEqual([own.id]);
    expect(requireAllianceAccess).toHaveBeenCalledWith({ allianceId: a.alliance.id, requiredPermission: Permissions.VIEW_MEMBERS });
  });

  it("retains zero and void events for archived members and inactive configuration", async () => {
    const s = await setup();
    await prisma.memberMetricEntry.create({ data: { ...s.data, value: 0, recordedAt: new Date("2026-11-10T12:00:00Z") } });
    await prisma.memberMetricEntry.create({ data: { ...s.data, value: null, status: "VOIDED" } });
    await prisma.allianceMember.update({ where: { id: s.member.id }, data: { archivedAt: new Date() } });
    await prisma.metricPeriod.update({ where: { id: s.period.id }, data: { active: false } });
    await prisma.metric.update({ where: { id: s.metric.id }, data: { active: false } });
    const history = await loadMemberMetricHistory(s.scope);
    expect(history.entries.map((e) => [e.status, e.value])).toEqual([["VOIDED", null], ["ACTIVE", 0]]);
    expect(history.member.archivedAt).not.toBeNull();
  });
});
