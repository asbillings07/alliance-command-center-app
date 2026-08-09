import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { memberPeriodMetricValues } from "./memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

// ADR-018 §1's rollup algebra, proved against real Postgres via the
// canonical read model (#287 database design §6/§7).
describe.skipIf(!runDb)("memberPeriodMetricValues rollup algebra [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeSetup(memberPeriodRollup: "LATEST" | "SUM" | "AVERAGE") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Rollup Algebra Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-14T23:59:59.999Z"),
      },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily Metric",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup,
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  async function insertEntry(params: {
    allianceMemberId: string;
    periodId: string;
    metricId: string;
    observedOn: string;
    value: number | null;
    status?: "ACTIVE" | "VOIDED";
    recordedAt: Date;
  }) {
    return prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: params.allianceMemberId,
        periodId: params.periodId,
        metricId: params.metricId,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date(`${params.observedOn}T00:00:00.000Z`),
        value: params.value,
        status: params.status ?? "ACTIVE",
        recordedAt: params.recordedAt,
        createdAt: params.recordedAt,
      },
    });
  }

  it("LATEST resolves to the active winning slot with the greatest observedOn, never the most-recently-written row (ADR-018 §1 worked example)", async () => {
    const { alliance, member, period, metric } = await makeSetup("LATEST");

    // Day 1 recorded first, day 2 recorded second, then a correction to
    // day 1's own slot is written *after* day 2 (a backdated correction).
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 100,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-09",
      value: 200,
      recordedAt: new Date("2026-01-09T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 150,
      recordedAt: new Date("2026-01-10T12:00:00.000Z"),
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    // The Saturday-written correction only changes which row wins day 1's
    // slot (150, not 100) - it must never displace day 2's later observedOn
    // in the across-slot LATEST rollup.
    expect(result?.value).toBe(200);
    expect(result?.observationCount).toBe(2);
    expect(result?.lastObservedOn?.toISOString()).toBe("2026-01-09T00:00:00.000Z");
    expect(result?.provenance).toBe("Derived (latest observation)");
  });

  it("SUM excludes a voided date from the aggregate entirely - never treated as 0", async () => {
    const { alliance, member, period, metric } = await makeSetup("SUM");

    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 10,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-07",
      value: 20,
      recordedAt: new Date("2026-01-07T12:00:00.000Z"),
    });
    // day 3 recorded, then voided by a later tombstone for the same slot.
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-08",
      value: 99,
      recordedAt: new Date("2026-01-08T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-08",
      value: null,
      status: "VOIDED",
      recordedAt: new Date("2026-01-08T13:00:00.000Z"),
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    expect(result?.value).toBe(30);
    expect(result?.observationCount).toBe(2);
    expect(result?.lastObservedOn?.toISOString()).toBe("2026-01-07T00:00:00.000Z");
    expect(result?.provenance).toBe("Derived (sum)");
  });

  it("AVERAGE excludes a voided date from both the numerator and the denominator", async () => {
    const { alliance, member, period, metric } = await makeSetup("AVERAGE");

    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 10,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-07",
      value: 100,
      recordedAt: new Date("2026-01-07T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-08",
      value: 30,
      recordedAt: new Date("2026-01-08T12:00:00.000Z"),
    });
    // Void day 2's slot - if it were still (wrongly) counted, the average
    // would be (10+30)/3 = 13.33, not 20; if it contributed as 0 the
    // average would be different again. Only (10+30)/2 = 20 is correct.
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-07",
      value: null,
      status: "VOIDED",
      recordedAt: new Date("2026-01-07T13:00:00.000Z"),
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    expect(result?.value).toBe(20);
    expect(result?.observationCount).toBe(2);
    expect(result?.provenance).toBe("Derived (average)");
  });

  it.each(["LATEST", "SUM", "AVERAGE"] as const)(
    "zero active winning slots produces value=NULL under %s, never 0 or absent from the result set",
    async (memberPeriodRollup) => {
      const { alliance, member, period, metric } = await makeSetup(memberPeriodRollup);

      const results = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);
      const [result] = results;

      expect(results).toHaveLength(1);
      expect(result?.allianceMemberId).toBe(member.id);
      expect(result?.value).toBeNull();
      expect(result?.observationCount).toBe(0);
      expect(result?.lastObservedOn).toBeNull();
    },
  );

  it("onlyParticipating: true restricts the result to rows with at least one active winning slot, pushing the filter into SQL instead of the caller's Node code", async () => {
    const { alliance, member, period, metric } = await makeSetup("SUM");
    const otherMember = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Never Participates" },
    });

    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 10,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });

    const defaultResults = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);
    const participatingOnlyResults = await memberPeriodMetricValues(alliance.id, period.id, [metric.id], {
      onlyParticipating: true,
    });

    // Default behavior is unchanged: both members appear, including the
    // one with zero active slots.
    expect(defaultResults).toHaveLength(2);
    expect(defaultResults.map((r) => r.allianceMemberId).sort()).toEqual(
      [member.id, otherMember.id].sort(),
    );

    // onlyParticipating excludes otherMember entirely, not just its value.
    expect(participatingOnlyResults).toHaveLength(1);
    expect(participatingOnlyResults[0]?.allianceMemberId).toBe(member.id);
    expect(participatingOnlyResults[0]?.value).toBe(10);
  });

  it("options.memberIds bounds both the ledger scan and the cross join to a known set of members, not just the returned result - for a paginated consumer that already knows which page it's on", async () => {
    const { alliance, member, period, metric } = await makeSetup("LATEST");
    const otherMember = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Off This Page" },
    });

    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 42,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: otherMember.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 99,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });

    const scopedResults = await memberPeriodMetricValues(alliance.id, period.id, [metric.id], {
      memberIds: [member.id],
    });

    // otherMember's row never round-trips from the DB at all - not merely
    // filtered out of the returned array - so this stays bounded to the
    // caller's known page regardless of alliance size.
    expect(scopedResults).toHaveLength(1);
    expect(scopedResults[0]?.allianceMemberId).toBe(member.id);
    expect(scopedResults[0]?.value).toBe(42);

    // A foreign-tenant member id is silently dropped, same as a
    // foreign-tenant metric id elsewhere - never a separate trust boundary.
    const otherAlliance = await prisma.alliance.create({ data: { name: "Other Alliance", server: "1002" } });
    createdAllianceIds.push(otherAlliance.id);
    const foreignMember = await prisma.allianceMember.create({
      data: { allianceId: otherAlliance.id, playerName: "Foreign Member" },
    });
    const withForeignMemberId = await memberPeriodMetricValues(alliance.id, period.id, [metric.id], {
      memberIds: [member.id, foreignMember.id],
    });
    expect(withForeignMemberId.map((r) => r.allianceMemberId)).toEqual([member.id]);

    // An empty memberIds array short-circuits to no query at all, mirroring
    // the existing empty-metricIds early return.
    expect(await memberPeriodMetricValues(alliance.id, period.id, [metric.id], { memberIds: [] })).toEqual([]);
  });

  it("a slot voided and then reactivated by a later ACTIVE row contributes its reactivated value, needing no special mechanism beyond latest-wins", async () => {
    const { alliance, member, period, metric } = await makeSetup("SUM");

    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 10,
      recordedAt: new Date("2026-01-06T12:00:00.000Z"),
    });
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: null,
      status: "VOIDED",
      recordedAt: new Date("2026-01-06T13:00:00.000Z"),
    });
    // Reactivation: a later ACTIVE row for the same slot.
    await insertEntry({
      allianceMemberId: member.id,
      periodId: period.id,
      metricId: metric.id,
      observedOn: "2026-01-06",
      value: 42,
      recordedAt: new Date("2026-01-06T14:00:00.000Z"),
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    expect(result?.value).toBe(42);
    expect(result?.observationCount).toBe(1);
  });
});
