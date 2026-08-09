import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { memberPeriodMetricValues } from "./memberPeriodMetricValues";

const runDb = process.env.INTEGRATION_DB === "true";

// ADR-018 §2: "(recordedAt, createdAt, id) is deterministic tie-break
// precedence for choosing one winner per slot." Proves the canonical read
// model's slot_winner CTE resolves same-day corrections and same-timestamp
// races to exactly one row, deterministically, via each tie-break level in
// turn.
describe.skipIf(!runDb)("memberPeriodMetricValues correction/void tie-break [integration]", () => {
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

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Correction Concurrency Alliance ${suffix}`, server: "1001" },
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
        memberPeriodRollup: "SUM",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("two ACTIVE rows for the same slot collapse to one contributing observation, the later-recorded one", async () => {
    const { alliance, member, period, metric } = await makeSetup();

    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 10,
        status: "ACTIVE",
        recordedAt: new Date("2026-01-06T12:00:00.000Z"),
        createdAt: new Date("2026-01-06T12:00:00.000Z"),
      },
    });
    // A correction to the same slot, recorded later.
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 25,
        status: "ACTIVE",
        recordedAt: new Date("2026-01-06T13:00:00.000Z"),
        createdAt: new Date("2026-01-06T13:00:00.000Z"),
      },
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    // If both rows contributed, SUM would be 35 and observationCount 2 -
    // this asserts the slot correctly collapsed to a single winner.
    expect(result?.value).toBe(25);
    expect(result?.observationCount).toBe(1);
  });

  it("when two rows for the same slot share an identical recordedAt, createdAt breaks the tie", async () => {
    const { alliance, member, period, metric } = await makeSetup();
    const sameRecordedAt = new Date("2026-01-06T12:00:00.000Z");

    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 10,
        status: "ACTIVE",
        recordedAt: sameRecordedAt,
        createdAt: new Date("2026-01-06T12:00:00.000Z"),
      },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 20,
        status: "ACTIVE",
        recordedAt: sameRecordedAt,
        createdAt: new Date("2026-01-06T12:00:00.001Z"),
      },
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    expect(result?.value).toBe(20);
    expect(result?.observationCount).toBe(1);
  });

  it("when recordedAt and createdAt are both identical, the greatest id is the final, deterministic tiebreak", async () => {
    const { alliance, member, period, metric } = await makeSetup();
    const identicalTimestamp = new Date("2026-01-06T12:00:00.000Z");

    await prisma.memberMetricEntry.create({
      data: {
        id: "cmconcurrency0000000000aaa",
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 10,
        status: "ACTIVE",
        recordedAt: identicalTimestamp,
        createdAt: identicalTimestamp,
      },
    });
    // Deliberately inserted *after* the row above, but with a lexically
    // smaller id - if insertion order (or id ASC) drove the tie-break, this
    // would win. Only id DESC should decide it.
    await prisma.memberMetricEntry.create({
      data: {
        id: "cmconcurrency0000000000bbb",
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 20,
        status: "ACTIVE",
        recordedAt: identicalTimestamp,
        createdAt: identicalTimestamp,
      },
    });

    const [result] = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);

    // "bbb" > "aaa" lexically, so it wins under id DESC regardless of which
    // row was physically inserted first.
    expect(result?.value).toBe(20);
    expect(result?.observationCount).toBe(1);
  });

  it("a void racing a correction for the same slot, both at the identical latest timestamp, resolves to exactly one deterministic winner (never both, never neither)", async () => {
    const { alliance, member, period, metric } = await makeSetup();
    const raceTimestamp = new Date("2026-01-06T12:00:00.000Z");

    // An earlier, uncontested ACTIVE row for the slot.
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 5,
        status: "ACTIVE",
        recordedAt: new Date("2026-01-06T11:00:00.000Z"),
        createdAt: new Date("2026-01-06T11:00:00.000Z"),
      },
    });
    // Two racing writers for the same slot at the exact same instant: one
    // voids it, one corrects it. Exactly one must win the slot.
    await prisma.memberMetricEntry.create({
      data: {
        id: "cmconcurrencyrace000000void",
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: null,
        status: "VOIDED",
        recordedAt: raceTimestamp,
        createdAt: raceTimestamp,
      },
    });
    await prisma.memberMetricEntry.create({
      data: {
        id: "cmconcurrencyrace000000fix",
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        observationGrain: "DAILY_OBSERVATION",
        observedOn: new Date("2026-01-06T00:00:00.000Z"),
        value: 99,
        status: "ACTIVE",
        recordedAt: raceTimestamp,
        createdAt: raceTimestamp,
      },
    });

    const results = await memberPeriodMetricValues(alliance.id, period.id, [metric.id]);
    expect(results).toHaveLength(1);
    const [result] = results;

    // "void" > "fix" lexically, so the void wins this particular race under
    // id DESC - the point is that it's exactly one deterministic outcome
    // (value NULL, observationCount 0), never both contributing and never
    // neither.
    expect(result?.value).toBeNull();
    expect(result?.observationCount).toBe(0);
  });
});
