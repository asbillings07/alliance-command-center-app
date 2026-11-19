import type { Prisma, AllianceRole } from "@/app/generated/prisma/client";
import { buildPermissionSet, hasPermission } from "../auth/permissions";
import {
  classifyTargets,
  deriveRequiredPermissions,
  resolveMetricTargets,
} from "../metricResolution";
import { normalizeName } from "../memberMatcher";
import { OcrEvaluationError } from "./config";
import { isRankingWeekPeriod, rankingWindow } from "./ranking";

const day = (d: Date | null) => d?.toISOString().slice(0, 10);
function stop(message: string): never {
  throw new OcrEvaluationError(message);
}

export async function planBatchDestination(
  tx: Prisma.TransactionClient,
  input: {
    allianceId: string;
    periodId: string;
    week: string;
    dailyMetric: string;
    weeklyMetric: string;
  },
  windows: string[],
  role: AllianceRole,
) {
  const { allianceId, week } = input;
  if (!rankingWindow({ kind: "weekly", label: "Weekly Rank" }, week))
    stop("Confirm the Monday that starts this scoring week.");
  const permissions = buildPermissionSet(role);
  const end = new Date(week + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const periodName = "VS week of " + week;
  const weekly = windows.some((w) => w.startsWith("week:"));
  const covers = (p: { startsAt: Date | null; endsAt: Date | null }) => {
    const start = day(p.startsAt),
      finish = day(p.endsAt);
    return (
      !!start &&
      !!finish &&
      windows.every((w) =>
        w.startsWith("week:")
          ? isRankingWeekPeriod(week, start, finish)
          : start <= w && w <= finish,
      )
    );
  };
  const periods = await tx.metricPeriod.findMany({
    where: { allianceId },
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      active: true,
    },
  });
  const matching = periods.filter((p) => p.active && covers(p));
  const exactWeek = matching.filter((p) =>
    isRankingWeekPeriod(week, day(p.startsAt), day(p.endsAt)),
  );
  const preferred = exactWeek.length ? exactWeek : matching;
  const automatic = input.periodId === "auto";
  if (automatic && preferred.length > 1)
    stop(
      "Several periods cover these dates. Choose the intended evaluation period.",
    );
  const period = automatic
    ? preferred[0]
    : periods.find((p) => p.id === input.periodId && p.active);
  if (!automatic && !period) stop("Choose an active evaluation period.");
  if (period && !covers(period))
    stop(
      weekly
        ? "A weekly total requires an evaluation period covering that one scoring week starting on that Monday."
        : "A screenshot date falls outside this evaluation period.",
    );
  if (
    !period &&
    periods.some(
      (p) =>
        (!p.active &&
          isRankingWeekPeriod(week, day(p.startsAt), day(p.endsAt))) ||
        normalizeName(p.name) === normalizeName(periodName),
    )
  )
    stop(
      "A period already uses this week or name. Review it in Periods before creating another.",
    );
  if (!period && !permissions.canConfigurePeriods)
    stop(
      "Someone with period configuration access must configure the scoring week before you can save these scores.",
    );
  const library = await tx.metric.findMany({
    where: { allianceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      active: true,
      type: true,
      observationGrain: true,
    },
  });
  const links = period
    ? await tx.metricPeriodMetric.findMany({
        where: { periodId: period.id, active: true },
        select: { metricId: true },
      })
    : [];
  const changes: string[] = period
    ? []
    : ["Create " + periodName + " (" + week + " to " + day(end) + ")"];
  const metrics = [true, false]
    .filter((daily) => windows.some((w) => daily !== w.startsWith("week:")))
    .map((daily) => {
      const selection = daily ? input.dailyMetric : input.weeklyMetric;
      const name = daily ? "Daily VS points" : "Weekly VS points";
      const grain = daily
        ? ("DAILY_OBSERVATION" as const)
        : ("PERIOD_VALUE" as const);
      const proposedName =
        selection === "auto"
          ? name
          : selection?.startsWith("create:")
            ? selection.slice(7).trim()
            : null;
      if (proposedName !== null && (!proposedName || proposedName.length > 100))
        stop("Enter a metric name of 1–100 characters.");
      let matches = library.filter((m) =>
        proposedName !== null
          ? normalizeName(m.name) === normalizeName(proposedName)
          : m.id === selection,
      );
      if (selection === "auto" && !matches.length) {
        const aliases = new Set([
          "vs",
          "vs points",
          "vs score",
          ...(daily
            ? ["daily vs", "vs daily", "vs daily points", "daily vs score"]
            : [
                "weekly vs",
                "weekly vs total",
                "weekly vs score",
                "vs weekly total",
              ]),
        ]);
        matches = library.filter(
          (m) =>
            m.active &&
            m.type === "NUMERIC" &&
            m.observationGrain === grain &&
            aliases.has(normalizeName(m.name)),
        );
      }
      if (matches.length > 1 || (proposedName === null && !matches.length))
        stop("Choose an unambiguous alliance metric for each score type.");
      const existing = matches[0];
      if (
        existing &&
        (!existing.active ||
          existing.type !== "NUMERIC" ||
          existing.observationGrain !== grain)
      )
        stop(
          "That metric is archived or uses another score type. Choose a compatible metric or a different name.",
        );
      const [target] = classifyTargets({
        targets: [
          existing
            ? { kind: "attach", metricId: existing.id }
            : { kind: "create", name: proposedName! },
        ],
        periodMetricIds: links.map((l) => l.metricId),
        libraryMetrics: library,
      });
      if (
        deriveRequiredPermissions([target]).some(
          (p) => !hasPermission(permissions, p),
        )
      )
        stop(
          "Someone with configuration access must create or attach this metric before you can save these scores.",
        );
      const metricName = existing?.name ?? proposedName!;
      if (target.disposition !== "existing")
        changes.push(
          (target.disposition === "create" ? "Create and attach " : "Attach ") +
            metricName,
        );
      return {
        daily,
        id: existing?.id ?? "new-metric:" + grain,
        name: metricName,
        target: { ...target, createGrain: grain },
      };
    });
  if (
    new Set(metrics.map((m) => normalizeName(m.name))).size !== metrics.length
  )
    stop("Use separate metrics for daily and weekly scores.");
  return {
    periodId: period?.id,
    name: period?.name ?? periodName,
    start: period?.startsAt ?? new Date(week + "T00:00:00Z"),
    end: period?.endsAt ?? end,
    metrics,
    changes,
  };
}

export async function applyBatchDestination(
  tx: Prisma.TransactionClient,
  allianceId: string,
  plan: Awaited<ReturnType<typeof planBatchDestination>>,
) {
  const periodId =
    plan.periodId ??
    (
      await tx.metricPeriod.create({
        data: {
          allianceId,
          name: plan.name,
          startsAt: plan.start,
          endsAt: plan.end,
        },
      })
    ).id;
  const resolved = await resolveMetricTargets(tx, {
    allianceId,
    periodId,
    classified: plan.metrics.map((m) => m.target),
  });
  return {
    periodId,
    ids: new Map(plan.metrics.map((m, i) => [m.id, resolved[i].metricId])),
  };
}
