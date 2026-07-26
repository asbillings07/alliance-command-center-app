"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  parseMetricRows,
  matchEntriesToMembers,
  type MatchSummary,
  type TableBoundsResult,
} from "@/app/src/lib/memberMatcher";
import { classifyColumn, type ColumnClassification } from "@/app/src/lib/columnClassifier";
import type { ParsedWorkbook } from "@/app/src/lib/workbookParser";
import type {
  PeriodMappingProposal,
  PeriodMappingReview,
  ColumnPeriodEvidence,
} from "@/app/src/lib/import/periodProposal";
import {
  buildPlannedMultiPeriodTranslationSummary,
  buildCommittedMultiPeriodTranslationSummary,
  type ColumnTarget,
} from "@/app/src/lib/importTranslation";
import { importMultiPeriodMetrics } from "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction";
import type { MultiPeriodImportMetricsResult } from "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction";

type MemberOption = { id: string; playerName: string };
type MetricOption = { id: string; name: string };

export type AlliancePeriodOption = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  metrics: MetricOption[];
};

type ColumnConfirmationStatus = "unconfirmed" | "confirmed_skip" | "confirmed_metric";

type ColumnMetricMapping = {
  columnIndex: number;
  columnName: string;
  classification: ColumnClassification;
  target: ColumnTarget;
  confirmationStatus: ColumnConfirmationStatus;
};

type ProposalMappingState = {
  proposalId: string;
  proposalName: string;
  excluded: boolean;
  targetPeriodId: string;
  columnMappings: ColumnMetricMapping[];
};

type MetricImportPreview = {
  proposalId: string;
  periodId: string;
  periodName: string;
  columnIndex: number;
  columnName: string;
  displayName: string;
  target: ColumnTarget;
  summary: MatchSummary;
};

type MultiPeriodImportFlowProps = {
  allianceId: string;
  routePeriodId: string;
  alliancePeriods: AlliancePeriodOption[];
  libraryMetrics: MetricOption[];
  canCreateMetrics: boolean;
  canAttachMetrics: boolean;
  members: MemberOption[];
  review: PeriodMappingReview;
  parsedWorkbook: ParsedWorkbook;
  selectedSheetIndex: number;
  tableBounds: TableBoundsResult | null;
  playerColumnIndex: number;
  onCancel: () => void;
};

type FlowStep = "map" | "preview" | "complete";

function formatPeriodLabel(period: AlliancePeriodOption): string {
  const dates =
    period.startsAt && period.endsAt
      ? `${period.startsAt.slice(0, 10)} – ${period.endsAt.slice(0, 10)}`
      : period.startsAt
        ? `from ${period.startsAt.slice(0, 10)}`
        : null;
  return dates ? `${period.name} (${dates})` : period.name;
}

function targetToToken(target: ColumnTarget): string {
  switch (target.kind) {
    case "skip":
      return "";
    case "existing":
      return `existing:${target.metricId}`;
    case "attach":
      return `attach:${target.metricId}`;
    case "create":
      return "create";
  }
}

function tokenToTarget(token: string, columnName: string): ColumnTarget {
  if (token === "") return { kind: "skip" };
  if (token === "create") return { kind: "create", name: columnName };
  const [kind, metricId] = token.split(":");
  if (kind === "existing" && metricId) return { kind: "existing", metricId };
  if (kind === "attach" && metricId) return { kind: "attach", metricId };
  return { kind: "skip" };
}

function toWireTarget(
  target: ColumnTarget,
): { kind: "existing"; metricId: string } | { kind: "create"; name: string } {
  if (target.kind === "create") return { kind: "create", name: target.name };
  if (target.kind === "existing" || target.kind === "attach") {
    return { kind: "existing", metricId: target.metricId };
  }
  throw new Error("Cannot send a skipped column");
}

function buildColumnMappingsForProposal(
  columns: ColumnPeriodEvidence[],
  periodMetrics: MetricOption[],
  libraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
): ColumnMetricMapping[] {
  const usedMetricIds = new Set<string>();
  return columns.map((col) => {
    const classification = classifyColumn({
      columnIndex: col.columnIndex,
      columnName: col.headerText,
      periodMetrics,
      libraryMetrics,
    });

    if (
      classification.reason === "matches_existing_metric" &&
      classification.matchedMetricId &&
      !usedMetricIds.has(classification.matchedMetricId)
    ) {
      usedMetricIds.add(classification.matchedMetricId);
      return {
        columnIndex: col.columnIndex,
        columnName: col.headerText,
        classification,
        target: { kind: "existing", metricId: classification.matchedMetricId },
        confirmationStatus: "confirmed_metric",
      };
    }

    if (
      classification.reason === "matches_library_metric" &&
      classification.matchedMetricId &&
      canAttachMetrics &&
      !usedMetricIds.has(classification.matchedMetricId)
    ) {
      usedMetricIds.add(classification.matchedMetricId);
      return {
        columnIndex: col.columnIndex,
        columnName: col.headerText,
        classification,
        target: { kind: "attach", metricId: classification.matchedMetricId },
        confirmationStatus: "confirmed_metric",
      };
    }

    if (classification.reason === "matches_metric_keyword" && canCreateMetrics) {
      return {
        columnIndex: col.columnIndex,
        columnName: col.headerText,
        classification,
        target: { kind: "create", name: col.proposedMetricName || col.headerText },
        confirmationStatus: "confirmed_metric",
      };
    }

    return {
      columnIndex: col.columnIndex,
      columnName: col.headerText,
      classification,
      target: { kind: "skip" },
      confirmationStatus: "unconfirmed",
    };
  });
}

function initialProposalStates(
  proposals: PeriodMappingProposal[],
  alliancePeriods: AlliancePeriodOption[],
  routePeriodId: string,
  libraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
): ProposalMappingState[] {
  const defaultPeriodId =
    alliancePeriods.find((p) => p.id === routePeriodId)?.id ?? alliancePeriods[0]?.id ?? "";

  return proposals.map((proposal) => {
    const period = alliancePeriods.find((p) => p.id === defaultPeriodId) ?? alliancePeriods[0];
    const periodMetrics = period?.metrics ?? [];
    const attachableLibrary = libraryMetrics.filter(
      (m) => !periodMetrics.some((pm) => pm.id === m.id),
    );

    return {
      proposalId: proposal.proposalId,
      proposalName: proposal.proposedPeriodName,
      excluded: false,
      targetPeriodId: period?.id ?? defaultPeriodId,
      columnMappings: buildColumnMappingsForProposal(
        proposal.columns,
        periodMetrics,
        attachableLibrary,
        canAttachMetrics,
        canCreateMetrics,
      ),
    };
  });
}

function qualifyingProposals(review: PeriodMappingReview): PeriodMappingProposal[] {
  return review.proposals.filter(
    (p) => p.confidence === "high" || p.confidence === "medium",
  );
}

export function MultiPeriodImportFlow({
  allianceId,
  routePeriodId,
  alliancePeriods,
  libraryMetrics,
  canCreateMetrics,
  canAttachMetrics,
  members,
  review,
  parsedWorkbook,
  selectedSheetIndex,
  tableBounds,
  playerColumnIndex,
  onCancel,
}: MultiPeriodImportFlowProps) {
  const router = useRouter();
  const proposals = useMemo(() => qualifyingProposals(review), [review]);
  const [step, setStep] = useState<FlowStep>("map");
  const [proposalStates, setProposalStates] = useState<ProposalMappingState[]>(() =>
    initialProposalStates(
      proposals,
      alliancePeriods,
      routePeriodId,
      libraryMetrics,
      canAttachMetrics,
      canCreateMetrics,
    ),
  );
  const [previews, setPreviews] = useState<MetricImportPreview[]>([]);
  const [importResult, setImportResult] = useState<MultiPeriodImportMetricsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const metricNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const period of alliancePeriods) {
      period.metrics.forEach((m) => map.set(m.id, m.name));
    }
    libraryMetrics.forEach((m) => map.set(m.id, m.name));
    return map;
  }, [alliancePeriods, libraryMetrics]);

  const activeStates = proposalStates.filter((s) => !s.excluded);

  const updateProposalState = (
    proposalId: string,
    updater: (state: ProposalMappingState) => ProposalMappingState,
  ) => {
    setProposalStates((prev) =>
      prev.map((state) => (state.proposalId === proposalId ? updater(state) : state)),
    );
  };

  const handlePeriodChange = (proposalId: string, targetPeriodId: string) => {
    const period = alliancePeriods.find((p) => p.id === targetPeriodId);
    if (!period) return;
    const attachableLibrary = libraryMetrics.filter(
      (m) => !period.metrics.some((pm) => pm.id === m.id),
    );
    const proposal = proposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;

    updateProposalState(proposalId, (state) => ({
      ...state,
      targetPeriodId,
      columnMappings: buildColumnMappingsForProposal(
        proposal.columns,
        period.metrics,
        attachableLibrary,
        canAttachMetrics,
        canCreateMetrics,
      ),
    }));
  };

  const setColumnTarget = (
    proposalId: string,
    columnIndex: number,
    token: string,
    columnName: string,
  ) => {
    updateProposalState(proposalId, (state) => ({
      ...state,
      columnMappings: state.columnMappings.map((m) => {
        if (m.columnIndex !== columnIndex) return m;
        const target = tokenToTarget(token, columnName);
        return {
          ...m,
          target,
          confirmationStatus:
            target.kind === "skip" ? m.confirmationStatus : "confirmed_metric",
        };
      }),
    }));
  };

  const canProceedToPreview =
    activeStates.length > 0 &&
    activeStates.every((state) => {
      const mapped = state.columnMappings.filter((m) => m.target.kind !== "skip");
      return mapped.length > 0 && state.targetPeriodId;
    }) &&
    new Set(activeStates.map((s) => s.targetPeriodId)).size === activeStates.length;

  const buildPreviews = (): MetricImportPreview[] => {
    const sheet = parsedWorkbook.sheets[selectedSheetIndex];
    if (!sheet) return [];

    const built: MetricImportPreview[] = [];
    for (const state of activeStates) {
      const period = alliancePeriods.find((p) => p.id === state.targetPeriodId);
      if (!period) continue;

      for (const mapping of state.columnMappings.filter((m) => m.target.kind !== "skip")) {
        const displayName =
          mapping.target.kind === "create"
            ? mapping.target.name
            : metricNameById.get(
                mapping.target.kind === "existing" || mapping.target.kind === "attach"
                  ? mapping.target.metricId
                  : "",
              ) ?? mapping.columnName;

        const parseResult = parseMetricRows(sheet.rows, {
          nameColumn: playerColumnIndex,
          valueColumn: mapping.columnIndex,
          hasHeader: true,
          tableBounds: tableBounds ?? undefined,
          metricName: displayName,
        });
        const summary = matchEntriesToMembers(parseResult.entries, members);

        built.push({
          proposalId: state.proposalId,
          periodId: state.targetPeriodId,
          periodName: period.name,
          columnIndex: mapping.columnIndex,
          columnName: mapping.columnName,
          displayName,
          target: mapping.target,
          summary,
        });
      }
    }
    return built;
  };

  const handlePreview = () => {
    setError(null);
    const nextPreviews = buildPreviews();
    if (nextPreviews.length === 0) {
      setError("Map at least one column in an included proposal to preview import.");
      return;
    }
    setPreviews(nextPreviews);
    setStep("preview");
  };

  const handleImport = () => {
    const groupsMap = new Map<
      string,
      {
        targetPeriodId: string;
        mappings: Parameters<typeof importMultiPeriodMetrics>[0]["groups"][number]["mappings"];
      }
    >();

    for (const preview of previews) {
      if (!groupsMap.has(preview.periodId)) {
        groupsMap.set(preview.periodId, { targetPeriodId: preview.periodId, mappings: [] });
      }
      const entries = preview.summary.results
        .filter(
          (r): r is typeof r & { memberId: string; rawValue: string } =>
            Boolean(r.memberId) && r.status !== "invalid_value" && Boolean(r.rawValue),
        )
        .map((r) => ({ memberId: r.memberId, rawValue: r.rawValue }));

      if (entries.length === 0) continue;

      groupsMap.get(preview.periodId)!.mappings.push({
        sourceColumnName: preview.columnName,
        target: toWireTarget(preview.target),
        entries,
      });
    }

    const groups = [...groupsMap.values()].filter((g) => g.mappings.length > 0);
    if (groups.length === 0) {
      setError("No matched entries to import");
      return;
    }

    startTransition(async () => {
      try {
        const result = await importMultiPeriodMetrics({ allianceId, groups });
        setImportResult(result);
        router.refresh();
        setStep("complete");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });
  };

  if (step === "complete" && importResult) {
    const committed = buildCommittedMultiPeriodTranslationSummary({ result: importResult });
    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="p-6 rounded-lg bg-success/10 border border-success/30 space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-bold text-success">Multi-Period Import Complete</h3>
            <p className="text-sm text-text-secondary mt-1">
              Recorded {committed.totalValuesCommitted} values across {committed.periods.length}{" "}
              evaluation {committed.periods.length === 1 ? "period" : "periods"}.
            </p>
          </div>
          {committed.periods.map((periodSummary) => (
            <div
              key={periodSummary.destinationPeriodName}
              className="bg-surface border border-border rounded-lg p-4"
            >
              <h4 className="text-sm font-semibold text-text-primary mb-2">
                {periodSummary.destinationPeriodName}
              </h4>
              <ul className="divide-y divide-border text-sm">
                {periodSummary.perMetricCounts.map((m) => (
                  <li key={m.metricId} className="flex justify-between py-1.5">
                    <span>{m.name}</span>
                    <span className="font-mono">{m.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary cursor-pointer"
          >
            Done
          </button>
          <Link
            href={`/alliances/${allianceId}`}
            className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover text-sm font-medium"
          >
            View Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (step === "preview") {
    const distinctMembers = new Set<string>();
    previews.forEach((p) => {
      p.summary.results.forEach((r) => {
        if (r.memberId && r.status !== "invalid_value") distinctMembers.add(r.memberId);
      });
    });

    const periodSummaries = [...new Map(
      previews.map((p) => [
        p.periodId,
        {
          periodId: p.periodId,
          periodName: p.periodName,
          mappedColumnsCount: previews.filter((x) => x.periodId === p.periodId).length,
          totalEntriesCount: previews
            .filter((x) => x.periodId === p.periodId)
            .reduce(
              (sum, preview) =>
                sum +
                preview.summary.results.filter(
                  (r) => r.memberId && r.status !== "invalid_value" && r.rawValue,
                ).length,
              0,
            ),
        },
      ]),
    ).values()];

    const planned = buildPlannedMultiPeriodTranslationSummary({
      matchedMembersCount: distinctMembers.size,
      periods: periodSummaries,
    });

    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="bg-surface border border-border rounded-xl p-4 text-xs space-y-2">
          <h4 className="font-semibold text-text-primary text-sm">Planned Multi-Period Import</h4>
          <p className="text-text-muted">
            Preview only — <strong>no database changes until you confirm</strong>.
          </p>
          <p>
            {planned.targetPeriodCount} periods · {planned.totalEntriesCount} entries ·{" "}
            {planned.matchedMembersCount} matched members
          </p>
          <ul className="space-y-1">
            {planned.periods.map((p) => (
              <li key={p.periodId}>
                <strong>{p.periodName}</strong>: {p.mappedColumnsCount} columns, {p.totalEntriesCount}{" "}
                entries
              </li>
            ))}
          </ul>
        </div>

        {previews.map((preview) => (
          <div
            key={`${preview.periodId}-${preview.columnIndex}`}
            className="border border-border rounded-lg p-4 bg-surface-secondary/30"
          >
            <p className="text-sm font-semibold text-text-primary">
              {preview.periodName} · {preview.columnName} → {preview.displayName}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {
                preview.summary.results.filter(
                  (r) => r.memberId && r.status !== "invalid_value" && r.rawValue,
                ).length
              }{" "}
              matched entries
            </p>
          </div>
        ))}

        {error && (
          <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => setStep("map")}
            className="px-4 py-2 rounded-md border border-border cursor-pointer"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isPending}
            className="px-4 py-2 rounded-md bg-success text-white cursor-pointer disabled:opacity-50"
          >
            {isPending ? "Importing..." : "Confirm Multi-Period Import"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl flex flex-col gap-5">
      <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-sm">
        <p className="font-medium text-text-primary">Map proposals to existing evaluation periods</p>
        <p className="text-text-secondary text-xs mt-1">
          Choose an existing period for each detected date group, map columns to metrics, or exclude a
          group. Each target period may only appear once — combine columns in one group if they share a
          destination.
        </p>
      </div>

      {proposalStates.map((state) => {
        const proposal = proposals.find((p) => p.proposalId === state.proposalId);
        if (!proposal) return null;
        const period = alliancePeriods.find((p) => p.id === state.targetPeriodId);
        const periodMetrics = period?.metrics ?? [];
        const attachableLibrary = libraryMetrics.filter(
          (m) => !periodMetrics.some((pm) => pm.id === m.id),
        );

        return (
          <div
            key={state.proposalId}
            className="border border-border rounded-xl p-4 bg-surface space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-text-primary text-sm">{state.proposalName}</h4>
                <p className="text-xs text-text-muted">{proposal.columns.length} columns</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={state.excluded}
                  onChange={(e) =>
                    updateProposalState(state.proposalId, (s) => ({
                      ...s,
                      excluded: e.target.checked,
                    }))
                  }
                />
                Exclude this proposal
              </label>
            </div>

            {!state.excluded && (
              <>
                <div>
                  <label className="text-xs font-medium text-text-primary block mb-1">
                    Target evaluation period
                  </label>
                  <select
                    value={state.targetPeriodId}
                    onChange={(e) => handlePeriodChange(state.proposalId, e.target.value)}
                    className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                  >
                    {alliancePeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatPeriodLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {state.columnMappings.map((mapping) => {
                    const usedElsewhere = new Set(
                      state.columnMappings
                        .filter((m) => m.columnIndex !== mapping.columnIndex)
                        .flatMap((m) =>
                          m.target.kind === "existing" || m.target.kind === "attach"
                            ? [m.target.metricId]
                            : [],
                        ),
                    );

                    return (
                      <div
                        key={mapping.columnIndex}
                        className="p-3 rounded-md border border-border bg-surface-secondary/30"
                      >
                        <p className="text-sm font-medium text-text-primary mb-2">
                          {mapping.columnName}
                        </p>
                        <select
                          aria-label={`Metric for ${mapping.columnName}`}
                          value={targetToToken(mapping.target)}
                          onChange={(e) =>
                            setColumnTarget(
                              state.proposalId,
                              mapping.columnIndex,
                              e.target.value,
                              mapping.columnName,
                            )
                          }
                          className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                        >
                          <option value="">Do not import</option>
                          {periodMetrics.length > 0 && (
                            <optgroup label="On target period">
                              {periodMetrics.map((metric) => (
                                <option
                                  key={metric.id}
                                  value={`existing:${metric.id}`}
                                  disabled={usedElsewhere.has(metric.id)}
                                >
                                  {metric.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {canAttachMetrics && attachableLibrary.length > 0 && (
                            <optgroup label="Add to target period">
                              {attachableLibrary.map((metric) => (
                                <option
                                  key={metric.id}
                                  value={`attach:${metric.id}`}
                                  disabled={usedElsewhere.has(metric.id)}
                                >
                                  {metric.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {canCreateMetrics && (
                            <option value="create">
                              Create &ldquo;{mapping.columnName}&rdquo;
                            </option>
                          )}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {error && (
        <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger">{error}</div>
      )}

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md border border-border cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={!canProceedToPreview}
          className="px-4 py-2 rounded-md bg-primary text-white cursor-pointer disabled:opacity-50"
        >
          Preview Multi-Period Import
        </button>
      </div>
    </div>
  );
}
