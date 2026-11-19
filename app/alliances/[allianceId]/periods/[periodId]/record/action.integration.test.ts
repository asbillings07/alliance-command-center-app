import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as RecordAction from "./action";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { manualTimingAvailable, manualTimingIsolated } from "@/app/src/lib/ocr/manualTiming";
vi.mock("@/app/src/lib/ocr/manualTiming", () => ({ manualTimingAvailable: vi.fn(), manualTimingIsolated: vi.fn() }));
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
  revalidateAllianceData: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("recordMemberMetrics [integration]", () => {
  let prisma: PrismaClient;
  let actorId: string;
  let recordMemberMetrics: typeof RecordAction.recordMemberMetrics;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ recordMemberMetrics } = await import("./action"));
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    const actor = await prisma.user.create({ data: {
      email: `metric-actor-${crypto.randomUUID()}@example.test`, displayName: "Test recorder",
    } });
    actorId = actor.id;
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: actorId, email: "test@local" },
      permissions: { canImportMetrics: true } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["permissions"],
      membership: { role: "ADMIN" } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["membership"],
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.qaManualTiming.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.allianceMembership.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
    await prisma.user.delete({ where: { id: actorId } });
  });

  async function makeSetup(
    metricType: "NUMERIC" | "BOOLEAN",
    observationGrain: "PERIOD_VALUE" | "DAILY_OBSERVATION" = "PERIOD_VALUE",
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Record Action Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
        await prisma.allianceMembership.create({ data: { allianceId: alliance.id, userId: actorId, role: "ADMIN" } });

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Period A" },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Metric",
        type: metricType,
        observationGrain,
        memberPeriodRollup: observationGrain === "DAILY_OBSERVATION" ? "SUM" : "LATEST",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("computes duration percentiles within row-count groups and excludes open and stopped tasks", async () => {
    const { qaManualTimingSummary } = await import("@/app/src/lib/platform/qaManualTimingSummary");
    const { alliance, period, metric } = await makeSetup("NUMERIC");
    const startedAt = new Date("2026-11-19T10:00:00Z");
    const base = { allianceId: alliance.id, userId: actorId, periodId: period.id, metricId: metric.id, startedAt };
    await prisma.qaManualTiming.createMany({ data: [
      ...[10, 30].map(seconds => ({ ...base, endedAt: new Date(+startedAt + seconds * 1000), savedRows: 27 })),
      { ...base, endedAt: new Date(+startedAt + 500000), savedRows: 28 },
      { ...base, endedAt: new Date(+startedAt + 1000000) }, base,
    ] });
    const rows = await qaManualTimingSummary();
    expect(rows.find(row => row.rows === 27)).toMatchObject({ state: "saved", samples: 2, median: 20, p90: 28 });
    expect(rows.find(row => row.state === "open")).toMatchObject({ median: null, p90: null });
    expect(rows.find(row => row.state === "stopped")).toMatchObject({ median: null, p90: null });
  });

  it("can stop timing after rollout is disabled and then save the same entries by hand", async () => {
    const { stopManualTiming } = await import("./timingActions");
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");
    const target = { allianceId: alliance.id, periodId: period.id, metricId: metric.id };
    const open = await prisma.qaManualTiming.create({ data: { ...target, userId: actorId } });
    const input = { ...target, entries: [{ memberId: member.id, value: 42 }] };
    vi.mocked(manualTimingAvailable).mockResolvedValue(false);
    vi.mocked(manualTimingIsolated).mockReturnValue(true);
    await expect(recordMemberMetrics({ ...input, timingId: open.id })).rejects.toThrow("unavailable");
    await stopManualTiming(alliance.id, period.id, open.id);
    await recordMemberMetrics(input);
    expect(await prisma.qaManualTiming.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ endedAt: expect.any(Date), savedRows: null });
    expect(await prisma.memberMetricEntry.count({ where: { periodId: period.id } })).toBe(1);
  });

  it("binds a timed save to its exact context and commits at most once", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");
    const target = { allianceId: alliance.id, periodId: period.id, metricId: metric.id };
    const entryFilter = { periodId: period.id, metricId: metric.id };
    const open = await prisma.qaManualTiming.create({ data: { ...target, userId: actorId } });
    const other = await prisma.qaManualTiming.create({ data: { ...target, userId: "synthetic-other" } });
    const input = { ...target, timingId: open.id, entries: [{ memberId: member.id, value: 9 }] };
    vi.mocked(manualTimingAvailable).mockResolvedValue(false);
    await expect(recordMemberMetrics(input)).rejects.toThrow("unavailable");
    vi.mocked(manualTimingAvailable).mockResolvedValue(true);
    await expect(recordMemberMetrics({ ...input, timingId: other.id })).rejects.toThrow("no longer open");
    expect(await prisma.memberMetricEntry.count({ where: entryFilter })).toBe(0);
    await recordMemberMetrics(input);
    await expect(recordMemberMetrics(input)).rejects.toThrow("no longer open");
    expect(await prisma.memberMetricEntry.count({ where: entryFilter })).toBe(1);
    expect(await prisma.qaManualTiming.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ savedRows: 1, endedAt: expect.any(Date) });
    expect(await prisma.qaManualTiming.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ savedRows: null, endedAt: null });
  });

  it("accepts 0 and 1 for a BOOLEAN metric", async () => {
    const { alliance, member, period, metric } = await makeSetup("BOOLEAN");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 1 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.value).toBe(1);
    expect(entry).toMatchObject({ enteredByUserId: actorId, enteredByName: "Test recorder", enteredByRole: "ADMIN", entryMethod: "MANUAL" });
  });

  it("rejects a non-0/1 value for a BOOLEAN metric with zero writes", async () => {
    const { alliance, member, period, metric } = await makeSetup("BOOLEAN");

    await expect(
      recordMemberMetrics({
        allianceId: alliance.id,
        periodId: period.id,
        metricId: metric.id,
        entries: [{ memberId: member.id, value: 2 }],
      }),
    ).rejects.toThrow("Boolean metric values must be exactly 0 or 1");

    const count = await prisma.memberMetricEntry.count({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(count).toBe(0);
  });

  it("still accepts arbitrary integers for a NUMERIC metric", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 4200 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.value).toBe(4200);
  });

  it("revalidates all five observation-changing-write domains (ADR-018), matching the touchAllianceSetupActivity call in the same transaction", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 100 }],
    });

    expect(revalidateAllianceData).toHaveBeenCalledWith({
      allianceId: alliance.id,
      periodId: period.id,
      domains: ["members", "dashboard", "setup", "evaluation-results", "reports"],
    });
  });

  it("writes observationGrain from the metric's own grain and status ACTIVE explicitly, never relying on the schema default (ADR-018 §3)", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 100 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.observationGrain).toBe("PERIOD_VALUE");
    expect(entry?.status).toBe("ACTIVE");
  });

  it("rejects recording against a DAILY_OBSERVATION metric with zero writes, since this form cannot collect observedOn (#287)", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC", "DAILY_OBSERVATION");

    await expect(
      recordMemberMetrics({
        allianceId: alliance.id,
        periodId: period.id,
        metricId: metric.id,
        entries: [{ memberId: member.id, value: 5 }],
      }),
    ).rejects.toThrow(/daily observations/i);

    const count = await prisma.memberMetricEntry.count({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(count).toBe(0);
  });
});
