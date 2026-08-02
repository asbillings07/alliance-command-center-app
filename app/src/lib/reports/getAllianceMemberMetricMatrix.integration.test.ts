import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { getAllianceMemberMetricMatrix } from "./getAllianceMemberMetricMatrix";
import type { MatrixColumnCandidate } from "./allianceMemberMatrix";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("getAllianceMemberMetricMatrix [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({ data: { name: `Matrix Alliance ${suffix}`, server: "1001" } });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMember(allianceId: string, playerName: string, archived = false) {
    return prisma.allianceMember.create({
      data: { allianceId, playerName, archivedAt: archived ? new Date("2026-01-01") : null },
    });
  }

  async function makePeriod(allianceId: string, name: string) {
    return prisma.metricPeriod.create({ data: { allianceId, name } });
  }

  async function makeMetric(allianceId: string, name: string, type: Metric_Type = Metric_Type.NUMERIC) {
    return prisma.metric.create({
      data: { allianceId, name, type, summaryKind: type === Metric_Type.BOOLEAN ? "TRUE_RATE" : "SUM" },
    });
  }

  async function attach(periodId: string, metricId: string, active = true) {
    return prisma.metricPeriodMetric.create({ data: { periodId, metricId, weight: 1, required: false, active } });
  }

  async function addEntry(allianceMemberId: string, periodId: string, metricId: string, value: number, at: Date) {
    return prisma.memberMetricEntry.create({
      data: { allianceMemberId, periodId, metricId, value, recordedAt: at, createdAt: at },
    });
  }

  function toCandidate(
    metric: { id: string; name: string; type: Metric_Type },
    attachmentStatus: MatrixColumnCandidate["attachmentStatus"],
    unitLabel: string | null = null,
  ): MatrixColumnCandidate {
    return { id: metric.id, name: metric.name, type: metric.type, unitLabel, attachmentStatus };
  }

  it("builds one cell per (member, selected column), reporting VALUE/MISSING/INVALID/NOT_ATTACHED honestly", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const alice = await makeMember(alliance.id, "Alice");
    const bob = await makeMember(alliance.id, "Bob");

    const numeric = await makeMetric(alliance.id, "Donations");
    await attach(period.id, numeric.id);
    await addEntry(alice.id, period.id, numeric.id, 500, new Date("2026-01-02"));
    // Bob never recorded a value for `numeric` -> MISSING.

    const boolean = await makeMetric(alliance.id, "Showed Up", Metric_Type.BOOLEAN);
    await attach(period.id, boolean.id);
    await addEntry(alice.id, period.id, boolean.id, 1, new Date("2026-01-02"));
    await addEntry(bob.id, period.id, boolean.id, 7, new Date("2026-01-02")); // legacy out-of-range -> INVALID

    const neverAttached = await makeMetric(alliance.id, "Never Attached");
    // Deliberately not attached at all this period.

    const candidates = [
      toCandidate(numeric, "ACTIVE"),
      toCandidate(boolean, "ACTIVE"),
      toCandidate(neverAttached, "NOT_ATTACHED"),
    ];

    const matrix = await getAllianceMemberMetricMatrix({ allianceId: alliance.id, periodId: period.id, candidates });

    expect(matrix.columns.map((c) => c.id)).toEqual([numeric.id, boolean.id, neverAttached.id]);

    const aliceRow = matrix.rows.find((r) => r.allianceMemberId === alice.id)!;
    expect(aliceRow.cells).toEqual([
      { metricId: numeric.id, status: "VALUE", value: 500 },
      { metricId: boolean.id, status: "VALUE", value: 1 },
      { metricId: neverAttached.id, status: "NOT_ATTACHED", value: null },
    ]);

    const bobRow = matrix.rows.find((r) => r.allianceMemberId === bob.id)!;
    expect(bobRow.cells).toEqual([
      { metricId: numeric.id, status: "MISSING", value: null },
      { metricId: boolean.id, status: "INVALID", value: 7 },
      { metricId: neverAttached.id, status: "NOT_ATTACHED", value: null },
    ]);
  });

  it("uses the latest entry per (member, metric) when multiple were recorded", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const alice = await makeMember(alliance.id, "Alice");
    const metric = await makeMetric(alliance.id, "Donations");
    await attach(period.id, metric.id);
    await addEntry(alice.id, period.id, metric.id, 100, new Date("2026-01-01"));
    await addEntry(alice.id, period.id, metric.id, 250, new Date("2026-01-05"));

    const matrix = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [toCandidate(metric, "ACTIVE")],
    });

    expect(matrix.rows[0]!.cells[0]).toEqual({ metricId: metric.id, status: "VALUE", value: 250 });
  });

  it("resolves an INACTIVE column's real historical values rather than blanking them", async () => {
    const alliance = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    const alice = await makeMember(alliance.id, "Alice");
    const metric = await makeMetric(alliance.id, "Donations");
    await attach(period.id, metric.id, false);
    await addEntry(alice.id, period.id, metric.id, 42, new Date("2026-01-01"));

    const matrix = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [toCandidate(metric, "INACTIVE")],
    });

    expect(matrix.rows[0]!.cells[0]).toEqual({ metricId: metric.id, status: "VALUE", value: 42 });
  });

  describe("column selection (server-enforced)", () => {
    it("defaults to every candidate when there are 6 or fewer", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const metrics = await Promise.all(
        Array.from({ length: 4 }, (_, i) => makeMetric(alliance.id, `Metric ${i}`)),
      );
      await Promise.all(metrics.map((m) => attach(period.id, m.id)));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: metrics.map((m) => toCandidate(m, "ACTIVE")),
      });

      expect(matrix.columns).toHaveLength(4);
    });

    it("caps at 6 and ignores requested IDs outside the candidate universe (never trusts client-supplied IDs)", async () => {
      const alliance = await makeAlliance();
      const other = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const otherMetric = await makeMetric(other.id, "Cross-tenant metric");
      const metrics = await Promise.all(
        Array.from({ length: 8 }, (_, i) => makeMetric(alliance.id, `Metric ${i}`)),
      );
      await Promise.all(metrics.map((m) => attach(period.id, m.id)));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: metrics.map((m) => toCandidate(m, "ACTIVE")),
        requestedColumnIds: [...metrics.map((m) => m.id), otherMetric.id],
      });

      expect(matrix.columns).toHaveLength(6);
      expect(matrix.columns.map((c) => c.id)).not.toContain(otherMetric.id);
    });
  });

  describe("archived-member inclusion tied to selected columns", () => {
    it("excludes an archived member from the 'all'/'archived' filter if their only contribution isn't a currently-selected column", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const archivedMember = await makeMember(alliance.id, "Retired Contributor", true);

      const selectedMetric = await makeMetric(alliance.id, "Selected");
      await attach(period.id, selectedMetric.id);
      const unselectedMetric = await makeMetric(alliance.id, "Unselected");
      await attach(period.id, unselectedMetric.id);
      // The archived member only contributed to the *unselected* metric.
      await addEntry(archivedMember.id, period.id, unselectedMetric.id, 10, new Date("2026-01-01"));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(selectedMetric, "ACTIVE"), toCandidate(unselectedMetric, "ACTIVE")],
        requestedColumnIds: [selectedMetric.id],
        filter: "all",
      });

      expect(matrix.rows.map((r) => r.allianceMemberId)).not.toContain(archivedMember.id);
    });

    it("includes an archived member once their contribution is to a currently-selected column", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const archivedMember = await makeMember(alliance.id, "Retired Contributor", true);
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);
      await addEntry(archivedMember.id, period.id, metric.id, 10, new Date("2026-01-01"));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
        filter: "all",
      });

      expect(matrix.rows.map((r) => r.allianceMemberId)).toContain(archivedMember.id);
    });
  });

  describe("sorting", () => {
    it("sorts by name ascending by default", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      await makeMember(alliance.id, "Zebra");
      await makeMember(alliance.id, "Apple");
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
      });

      expect(matrix.rows.map((r) => r.playerName)).toEqual(["Apple", "Zebra"]);
    });

    it("sorts by a selected metric's value, bucketing valid before invalid before missing regardless of direction", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const hasValue = await makeMember(alliance.id, "Has Value");
      const hasInvalid = await makeMember(alliance.id, "Has Invalid");
      await makeMember(alliance.id, "Missing");
      const metric = await makeMetric(alliance.id, "Showed Up", Metric_Type.BOOLEAN);
      await attach(period.id, metric.id);
      await addEntry(hasValue.id, period.id, metric.id, 1, new Date("2026-01-01"));
      await addEntry(hasInvalid.id, period.id, metric.id, 9, new Date("2026-01-01"));
      // `missing` never recorded a value.

      const candidates = [toCandidate(metric, "ACTIVE")];

      const asc = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates,
        sort: metric.id,
        sortDirection: "asc",
      });
      expect(asc.rows.map((r) => r.playerName)).toEqual(["Has Value", "Has Invalid", "Missing"]);

      const desc = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates,
        sort: metric.id,
        sortDirection: "desc",
      });
      // Direction only flips the valid tier's internal order (moot here —
      // only one valid value) — invalid still follows valid, missing still last.
      expect(desc.rows.map((r) => r.playerName)).toEqual(["Has Value", "Has Invalid", "Missing"]);
    });

    it("sorts numeric values within the valid tier according to direction", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const low = await makeMember(alliance.id, "Low");
      const high = await makeMember(alliance.id, "High");
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);
      await addEntry(low.id, period.id, metric.id, 10, new Date("2026-01-01"));
      await addEntry(high.id, period.id, metric.id, 100, new Date("2026-01-01"));

      const candidates = [toCandidate(metric, "ACTIVE")];

      const asc = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates,
        sort: metric.id,
        sortDirection: "asc",
      });
      expect(asc.rows.map((r) => r.playerName)).toEqual(["Low", "High"]);

      const desc = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates,
        sort: metric.id,
        sortDirection: "desc",
      });
      expect(desc.rows.map((r) => r.playerName)).toEqual(["High", "Low"]);
    });

    it("breaks value ties by player name, then member id", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      const bob = await makeMember(alliance.id, "Bob");
      const alice = await makeMember(alliance.id, "Alice");
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);
      await addEntry(bob.id, period.id, metric.id, 50, new Date("2026-01-01"));
      await addEntry(alice.id, period.id, metric.id, 50, new Date("2026-01-01"));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
        sort: metric.id,
        sortDirection: "desc",
      });

      expect(matrix.rows.map((r) => r.playerName)).toEqual(["Alice", "Bob"]);
    });

    it("falls back to name sort when the requested sort metric isn't currently selected", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      await makeMember(alliance.id, "Zebra");
      await makeMember(alliance.id, "Apple");
      const selected = await makeMetric(alliance.id, "Selected");
      await attach(period.id, selected.id);
      const notSelected = await makeMetric(alliance.id, "Not Selected");
      await attach(period.id, notSelected.id);

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(selected, "ACTIVE"), toCandidate(notSelected, "ACTIVE")],
        requestedColumnIds: [selected.id],
        sort: notSelected.id,
      });

      expect(matrix.sort).toEqual({ kind: "name", direction: "asc" });
      expect(matrix.rows.map((r) => r.playerName)).toEqual(["Apple", "Zebra"]);
    });
  });

  describe("search, filter, and pagination", () => {
    it("filters the roster by search term", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      await makeMember(alliance.id, "Alice Anderson");
      await makeMember(alliance.id, "Bob Baker");
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
        search: "ander",
      });

      expect(matrix.rows.map((r) => r.playerName)).toEqual(["Alice Anderson"]);
    });

    it("paginates the roster, bounded by pageSize (clamped to the shared read-model minimum)", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => makeMember(alliance.id, `Member ${String(i).padStart(2, "0")}`)),
      );
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);

      const page1 = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
        pageSize: 10,
        page: 1,
      });
      expect(page1.rows).toHaveLength(10);
      expect(page1.pagination).toEqual({ page: 1, pageSize: 10, totalRowCount: 12 });

      const page2 = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
        pageSize: 10,
        page: 2,
      });
      expect(page2.rows).toHaveLength(2);
    });

    it("defaults the roster filter to active members only", async () => {
      const alliance = await makeAlliance();
      const period = await makePeriod(alliance.id, "Week 1");
      await makeMember(alliance.id, "Active Member", false);
      const archived = await makeMember(alliance.id, "Archived Member", true);
      const metric = await makeMetric(alliance.id, "Donations");
      await attach(period.id, metric.id);
      await addEntry(archived.id, period.id, metric.id, 5, new Date("2026-01-01"));

      const matrix = await getAllianceMemberMetricMatrix({
        allianceId: alliance.id,
        periodId: period.id,
        candidates: [toCandidate(metric, "ACTIVE")],
      });

      expect(matrix.rows.map((r) => r.playerName)).toEqual(["Active Member"]);
    });
  });

  it("never leaks another alliance's members into the roster", async () => {
    const alliance = await makeAlliance();
    const other = await makeAlliance();
    const period = await makePeriod(alliance.id, "Week 1");
    await makeMember(alliance.id, "In Alliance");
    await makeMember(other.id, "Other Alliance Member");
    const metric = await makeMetric(alliance.id, "Donations");
    await attach(period.id, metric.id);

    const matrix = await getAllianceMemberMetricMatrix({
      allianceId: alliance.id,
      periodId: period.id,
      candidates: [toCandidate(metric, "ACTIVE")],
    });

    expect(matrix.rows.map((r) => r.playerName)).toEqual(["In Alliance"]);
  });
});
