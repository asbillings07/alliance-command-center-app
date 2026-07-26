"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  parseMetricRows,
  matchEntriesToMembers,
  type TableBoundsResult,
} from "@/app/src/lib/memberMatcher";
import { classifyColumn, type ColumnClassification } from "@/app/src/lib/columnClassifier";
import type { ParsedWorkbook, WorkbookIssue } from "@/app/src/lib/workbookParser";
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
import {
  getPreviewEntries,
  dispositionForTarget,
  type MetricImportPreviewData,
} from "@/app/src/lib/import/importPreviewHelpers";
import { MetricPreviewSection } from "@/app/src/components/spreadsheet/MetricPreviewSection";
import {
  ValueIssueNotice,
  WorkbookIssueNotice,
} from "@/app/src/components/spreadsheet/ImportDiagnosticNotices";
import { importMultiPeriodMetrics } from "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction";
import type { MultiPeriodImportMetricsResult } from "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction";

type MemberOption = { id: string; playerName: string };
type MetricOption = { id: string; name: string };

import {
  sortAlliancePeriods,
  type AlliancePeriodOption,
} from "@/app/src/lib/import/multiPeriodImportUi";

type ColumnConfirmationStatus = "unconfirmed" | "confirmed_skip" | "confirmed_metric";

type ColumnMetricMapping = {
  columnIndex: number;
  columnName: string;
  proposedMetricName: string;
  targetPeriodId: string;
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

type MultiPeriodMetricPreview = MetricImportPreviewData & {
  proposalId: string;
  periodId: string;
  periodName: string;
};

type DuplicateSelections = Record<number, Record<string, number>>;

type MultiPeriodImportFlowProps = {
  allianceId: string;
  routePeriodId: string;
  alliancePeriods: AlliancePeriodOption[];
  /** Full active alliance metric library — attachable subsets are derived per target period. */
  allianceLibraryMetrics: MetricOption[];
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

/** Distinct from confirmed skip (`skip`) so native change events fire from the initial state. */
export const UNCONFIRMED_TARGET_TOKEN = "__unconfirmed__";
const SKIP_TARGET_TOKEN = "skip";

function metricIdentity(col: ColumnPeriodEvidence): string {
  return col.proposedMetricName || col.headerText;
}

function formatPeriodLabel(period: AlliancePeriodOption): string {
  const dates =
    period.startsAt && period.endsAt
      ? `${period.startsAt.slice(0, 10)} – ${period.endsAt.slice(0, 10)}`
      : period.startsAt
        ? `from ${period.startsAt.slice(0, 10)}`
        : null;
  return dates ? `${period.name} (${dates})` : period.name;
}

function attachableLibraryForPeriod(
  periodId: string,
  alliancePeriods: AlliancePeriodOption[],
  allianceLibraryMetrics: MetricOption[],
): MetricOption[] {
  const period = alliancePeriods.find((p) => p.id === periodId);
  const attachedIds = new Set(period?.metrics.map((m) => m.id) ?? []);
  return allianceLibraryMetrics.filter((m) => !attachedIds.has(m.id));
}

function mappingTargetToToken(mapping: ColumnMetricMapping): string {
  if (mapping.confirmationStatus === "unconfirmed") {
    return UNCONFIRMED_TARGET_TOKEN;
  }
  return targetToToken(mapping.target);
}

function targetToToken(target: ColumnTarget): string {
  switch (target.kind) {
    case "skip":
      return SKIP_TARGET_TOKEN;
    case "existing":
      return `existing:${target.metricId}`;
    case "attach":
      return `attach:${target.metricId}`;
    case "create":
      return "create";
  }
}

function tokenToTarget(token: string, proposedMetricName: string): ColumnTarget {
  if (token === UNCONFIRMED_TARGET_TOKEN) {
    return { kind: "skip" };
  }
  if (token === SKIP_TARGET_TOKEN) return { kind: "skip" };
  if (token === "create") return { kind: "create", name: proposedMetricName };
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

function resolveMetricCollisionKey(target: ColumnTarget): string | null {
  if (target.kind === "skip") return null;
  if (target.kind === "create") return `create:${target.name.trim().toLowerCase()}`;
  return `metric:${target.metricId}`;
}

function findPeriodMetricCollisions(
  mappings: ColumnMetricMapping[],
  metricNameById: Map<string, string>,
): string | null {
  const byPeriod = new Map<string, Map<string, string>>();

  for (const mapping of mappings) {
    if (mapping.confirmationStatus !== "confirmed_metric" || mapping.target.kind === "skip") {
      continue;
    }
    const key = resolveMetricCollisionKey(mapping.target);
    if (!key) continue;

    const periodCollisions = byPeriod.get(mapping.targetPeriodId) ?? new Map<string, string>();
    if (periodCollisions.has(key)) {
      const metricLabel =
        mapping.target.kind === "create"
          ? mapping.proposedMetricName
          : metricNameById.get(
              mapping.target.kind === "existing" || mapping.target.kind === "attach"
                ? mapping.target.metricId
                : "",
            ) ?? mapping.proposedMetricName;
      return `${metricLabel} is already mapped for this period from ${periodCollisions.get(key)}`;
    }
    periodCollisions.set(key, mapping.columnName);
    byPeriod.set(mapping.targetPeriodId, periodCollisions);
  }

  return null;
}

function buildColumnMappingsForProposal(
  columns: ColumnPeriodEvidence[],
  targetPeriodId: string,
  periodMetrics: MetricOption[],
  attachableLibrary: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
): ColumnMetricMapping[] {
  const usedMetricIds = new Set<string>();
  return columns.map((col) => {
    const proposedMetricName = metricIdentity(col);
    const classification = classifyColumn({
      columnIndex: col.columnIndex,
      columnName: proposedMetricName,
      periodMetrics,
      libraryMetrics: attachableLibrary,
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
        proposedMetricName,
        targetPeriodId,
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
        proposedMetricName,
        targetPeriodId,
        classification,
        target: { kind: "attach", metricId: classification.matchedMetricId },
        confirmationStatus: "confirmed_metric",
      };
    }

    if (classification.reason === "matches_metric_keyword" && canCreateMetrics) {
      return {
        columnIndex: col.columnIndex,
        columnName: col.headerText,
        proposedMetricName,
        targetPeriodId,
        classification,
        target: { kind: "create", name: proposedMetricName },
        confirmationStatus: "confirmed_metric",
      };
    }

    return {
      columnIndex: col.columnIndex,
      columnName: col.headerText,
      proposedMetricName,
      targetPeriodId,
      classification,
      target: { kind: "skip" },
      confirmationStatus: "unconfirmed",
    };
  });
}

function initialProposalStates(
  proposals: PeriodMappingProposal[],
  sortedPeriods: AlliancePeriodOption[],
  routePeriodId: string,
  allianceLibraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
): ProposalMappingState[] {
  const defaultPeriodId =
    sortedPeriods.find((p) => p.id === routePeriodId)?.id ?? sortedPeriods[0]?.id ?? "";

  return proposals.map((proposal) => {
    const period = sortedPeriods.find((p) => p.id === defaultPeriodId) ?? sortedPeriods[0];
    const periodMetrics = period?.metrics ?? [];
    const attachableLibrary = attachableLibraryForPeriod(
      period?.id ?? defaultPeriodId,
      sortedPeriods,
      allianceLibraryMetrics,
    );

    return {
      proposalId: proposal.proposalId,
      proposalName: proposal.proposedPeriodName,
      excluded: false,
      targetPeriodId: period?.id ?? defaultPeriodId,
      columnMappings: buildColumnMappingsForProposal(
        proposal.columns,
        period?.id ?? defaultPeriodId,
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

function allActiveColumnMappings(states: ProposalMappingState[]): ColumnMetricMapping[] {
  return states.filter((s) => !s.excluded).flatMap((s) => s.columnMappings);
}

export function MultiPeriodImportFlow({
  allianceId,
  routePeriodId,
  alliancePeriods,
  allianceLibraryMetrics,
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
  const sortedPeriods = useMemo(() => sortAlliancePeriods(alliancePeriods), [alliancePeriods]);
  const proposals = useMemo(() => qualifyingProposals(review), [review]);
  const [step, setStep] = useState<FlowStep>("map");
  const [proposalStates, setProposalStates] = useState<ProposalMappingState[]>(() =>
    initialProposalStates(
      proposals,
      sortedPeriods,
      routePeriodId,
      allianceLibraryMetrics,
      canAttachMetrics,
      canCreateMetrics,
    ),
  );
  const [previews, setPreviews] = useState<MultiPeriodMetricPreview[]>([]);
  const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelections>({});
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<MultiPeriodImportMetricsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const metricNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const period of sortedPeriods) {
      period.metrics.forEach((m) => map.set(m.id, m.name));
    }
    allianceLibraryMetrics.forEach((m) => map.set(m.id, m.name));
    return map;
  }, [sortedPeriods, allianceLibraryMetrics]);

  const activeStates = proposalStates.filter((s) => !s.excluded);
  const activeColumnMappings = useMemo(
    () => allActiveColumnMappings(proposalStates),
    [proposalStates],
  );

  const periodMetricCollision = useMemo(
    () => findPeriodMetricCollisions(activeColumnMappings, metricNameById),
    [activeColumnMappings, metricNameById],
  );

  const updateProposalState = (
    proposalId: string,
    updater: (state: ProposalMappingState) => ProposalMappingState,
  ) => {
    setProposalStates((prev) =>
      prev.map((state) => (state.proposalId === proposalId ? updater(state) : state)),
    );
  };

  const handlePeriodChange = (proposalId: string, targetPeriodId: string) => {
    const period = sortedPeriods.find((p) => p.id === targetPeriodId);
    if (!period) return;
    const attachableLibrary = attachableLibraryForPeriod(
      targetPeriodId,
      sortedPeriods,
      allianceLibraryMetrics,
    );
    const proposal = proposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;

    updateProposalState(proposalId, (state) => ({
      ...state,
      targetPeriodId,
      columnMappings: buildColumnMappingsForProposal(
        proposal.columns,
        targetPeriodId,
        period.metrics,
        attachableLibrary,
        canAttachMetrics,
        canCreateMetrics,
      ),
    }));
  };

  const handleColumnPeriodChange = (
    proposalId: string,
    columnIndex: number,
    targetPeriodId: string,
  ) => {
    const period = sortedPeriods.find((p) => p.id === targetPeriodId);
    if (!period) return;
    const attachableLibrary = attachableLibraryForPeriod(
      targetPeriodId,
      sortedPeriods,
      allianceLibraryMetrics,
    );
    const proposal = proposals.find((p) => p.proposalId === proposalId);
    const col = proposal?.columns.find((c) => c.columnIndex === columnIndex);
    if (!col) return;

    updateProposalState(proposalId, (state) => ({
      ...state,
      columnMappings: state.columnMappings.map((mapping) => {
        if (mapping.columnIndex !== columnIndex) return mapping;
        const rebuilt = buildColumnMappingsForProposal(
          [col],
          targetPeriodId,
          period.metrics,
          attachableLibrary,
          canAttachMetrics,
          canCreateMetrics,
        )[0];
        return {
          ...rebuilt,
          targetPeriodId,
          confirmationStatus:
            mapping.confirmationStatus === "confirmed_skip"
              ? "confirmed_skip"
              : rebuilt.confirmationStatus,
          target:
            mapping.confirmationStatus === "confirmed_skip"
              ? { kind: "skip" as const }
              : rebuilt.target,
        };
      }),
    }));
  };

  const setColumnTarget = (
    proposalId: string,
    columnIndex: number,
    token: string,
    proposedMetricName: string,
  ) => {
    updateProposalState(proposalId, (state) => ({
      ...state,
      columnMappings: state.columnMappings.map((m) => {
        if (m.columnIndex !== columnIndex) return m;
        if (token === UNCONFIRMED_TARGET_TOKEN) return m;
        const target = tokenToTarget(token, proposedMetricName);
        const confirmationStatus: ColumnConfirmationStatus =
          target.kind === "skip" ? "confirmed_skip" : "confirmed_metric";
        return { ...m, target, confirmationStatus };
      }),
    }));
  };

  const getUsedMetricIdsForPeriod = (periodId: string, excludeColumnIndex: number) =>
    new Set(
      activeColumnMappings
        .filter(
          (m) =>
            m.targetPeriodId === periodId &&
            m.columnIndex !== excludeColumnIndex &&
            m.confirmationStatus === "confirmed_metric" &&
            (m.target.kind === "existing" || m.target.kind === "attach"),
        )
        .flatMap((m) =>
          m.target.kind === "existing" || m.target.kind === "attach" ? [m.target.metricId] : [],
        ),
    );

  const allColumnsConfirmed = activeStates.every((state) =>
    state.columnMappings.every(
      (m) => m.confirmationStatus === "confirmed_metric" || m.confirmationStatus === "confirmed_skip",
    ),
  );

  const hasConfirmedMetricImport = activeColumnMappings.some(
    (m) => m.confirmationStatus === "confirmed_metric" && m.target.kind !== "skip",
  );

  const canProceedToPreview =
    activeStates.length > 0 &&
    allColumnsConfirmed &&
    hasConfirmedMetricImport &&
    !periodMetricCollision;

  const displayNameFor = (target: ColumnTarget, proposedMetricName: string): string => {
    if (target.kind === "existing" || target.kind === "attach") {
      return metricNameById.get(target.metricId) ?? proposedMetricName;
    }
    if (target.kind === "create") return target.name;
    return proposedMetricName;
  };

  const buildPreviews = (): {
    previews: MultiPeriodMetricPreview[];
    selections: DuplicateSelections;
  } => {
    const sheet = parsedWorkbook.sheets[selectedSheetIndex];
    if (!sheet) return { previews: [], selections: duplicateSelections };

    const built: MultiPeriodMetricPreview[] = [];
    const nextSelections: DuplicateSelections = { ...duplicateSelections };
    const aggregatedErrors: string[] = [];

    for (const state of activeStates) {
      for (const mapping of state.columnMappings.filter(
        (m) => m.confirmationStatus === "confirmed_metric" && m.target.kind !== "skip",
      )) {
        const period = sortedPeriods.find((p) => p.id === mapping.targetPeriodId);
        if (!period) continue;

        const displayName = displayNameFor(mapping.target, mapping.proposedMetricName);
        const parseResult = parseMetricRows(sheet.rows, {
          nameColumn: playerColumnIndex,
          valueColumn: mapping.columnIndex,
          hasHeader: true,
          tableBounds: tableBounds ?? undefined,
          metricName: displayName,
        });

        parseResult.errors.forEach((err) =>
          aggregatedErrors.push(`${mapping.columnName}: ${err}`),
        );

        const summary = matchEntriesToMembers(parseResult.entries, members);
        const selections: Record<string, number> = nextSelections[mapping.columnIndex]
          ? { ...nextSelections[mapping.columnIndex] }
          : {};

        summary.results.forEach((result, index) => {
          if ((result.status === "matched" || result.status === "duplicate") && result.memberId) {
            if (!(result.memberId in selections)) selections[result.memberId] = index;
          }
        });

        built.push({
          proposalId: state.proposalId,
          periodId: mapping.targetPeriodId,
          periodName: period.name,
          columnIndex: mapping.columnIndex,
          columnName: mapping.columnName,
          proposedMetricName: mapping.proposedMetricName,
          displayName,
          disposition: dispositionForTarget(mapping.target),
          target: mapping.target,
          summary,
          skippedBlankCells: parseResult.skippedBlankCells,
          invalidValueIssues: parseResult.invalidValueIssues,
          missingIdentityIssues: parseResult.missingIdentityIssues,
        });
        nextSelections[mapping.columnIndex] = selections;
      }
    }

    setParseErrors(aggregatedErrors);
    return { previews: built, selections: nextSelections };
  };

  const handlePreview = () => {
    setError(null);
    if (periodMetricCollision) {
      setError(periodMetricCollision);
      return;
    }

    const { previews: nextPreviews, selections: nextSelections } = buildPreviews();
    setDuplicateSelections(nextSelections);
    const totalMatched = nextPreviews.reduce(
      (sum, p) => sum + getPreviewEntries(p, nextSelections[p.columnIndex]).length,
      0,
    );
    const totalMissingIdentity = nextPreviews.reduce(
      (sum, p) => sum + p.missingIdentityIssues.length,
      0,
    );
    const totalInvalidValues = nextPreviews.reduce(
      (sum, p) => sum + p.invalidValueIssues.length,
      0,
    );

    if (nextPreviews.length === 0) {
      setError("Map at least one column in an included proposal to preview import.");
      return;
    }
    if (totalMissingIdentity > 0) {
      setError(
        `Cannot preview: ${totalMissingIdentity} ${totalMissingIdentity === 1 ? "cell contains" : "cells contain"} metric values but missing player names.`,
      );
      return;
    }
    if (totalInvalidValues > 0) {
      setError(
        `Cannot preview: ${totalInvalidValues} ${totalInvalidValues === 1 ? "cell contains" : "cells contain"} invalid non-whole-number values.`,
      );
      return;
    }
    if (totalMatched === 0) {
      setError("No rows matched any of your alliance members for the mapped columns.");
      return;
    }

    setPreviews(nextPreviews);
    setStep("preview");
  };

  const handleDuplicateSelection = (columnIndex: number, memberId: string, resultIndex: number) => {
    setDuplicateSelections((prev) => ({
      ...prev,
      [columnIndex]: { ...(prev[columnIndex] ?? {}), [memberId]: resultIndex },
    }));
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
      const entries = getPreviewEntries(preview, duplicateSelections[preview.columnIndex]);
      if (entries.length === 0) continue;

      if (!groupsMap.has(preview.periodId)) {
        groupsMap.set(preview.periodId, { targetPeriodId: preview.periodId, mappings: [] });
      }

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

  const currentSheet = parsedWorkbook.sheets[selectedSheetIndex];
  const mappedColumnIndices = new Set([
    playerColumnIndex,
    ...activeColumnMappings
      .filter((m) => m.confirmationStatus === "confirmed_metric" && m.target.kind !== "skip")
      .map((m) => m.columnIndex),
  ]);

  const activeDataStart = tableBounds ? tableBounds.dataStartIndex : 0;
  const activeDataEnd = tableBounds ? tableBounds.dataEndIndex : (currentSheet?.rows.length ?? 0);
  const selectedRegion = tableBounds?.tableRegions[0];
  const activeStartCol = selectedRegion ? selectedRegion.startColumn : 0;
  const activeEndCol = selectedRegion ? selectedRegion.endColumn : 999;

  const blockingCellIssues: WorkbookIssue[] = [];
  const warningCellIssues: WorkbookIssue[] = [];

  if (currentSheet?.issues) {
    for (const issue of currentSheet.issues) {
      if (!mappedColumnIndices.has(issue.columnIndex)) continue;
      if (issue.rowIndex < activeDataStart || issue.rowIndex >= activeDataEnd) continue;
      if (issue.columnIndex < activeStartCol || issue.columnIndex > activeEndCol) continue;

      if (
        issue.severity === "blocking" ||
        issue.code === "formula_missing_cached_value" ||
        issue.code === "cell_error"
      ) {
        blockingCellIssues.push(issue);
      } else if (issue.severity === "warning") {
        warningCellIssues.push(issue);
      }
    }
  }

  const columnNameByIndex = new Map<number, string>();
  activeColumnMappings.forEach((m) => columnNameByIndex.set(m.columnIndex, m.columnName));
  columnNameByIndex.set(playerColumnIndex, "Player");

  const previewValueIssues = previews.flatMap((preview) => [
    ...preview.invalidValueIssues.map((issue) => ({
      columnName: preview.columnName,
      error: `${issue.address}: ${issue.error}`,
    })),
    ...preview.missingIdentityIssues.map((issue) => ({
      columnName: preview.columnName,
      error: `${issue.address} (Value "${issue.rawValue}"): ${issue.error}`,
    })),
  ]);

  const totalToImport = useMemo(
    () =>
      previews.reduce(
        (sum, p) => sum + getPreviewEntries(p, duplicateSelections[p.columnIndex]).length,
        0,
      ),
    [previews, duplicateSelections],
  );

  const hasBlockingParseErrors =
    parseErrors.length > 0 ||
    previews.some((preview) =>
      preview.summary.results.some((r) => r.status === "invalid_value" || !!r.error),
    );
  const hasBlockingDiagnostics = blockingCellIssues.length > 0;

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
      getPreviewEntries(p, duplicateSelections[p.columnIndex]).forEach((entry) => {
        distinctMembers.add(entry.memberId);
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
                sum + getPreviewEntries(preview, duplicateSelections[preview.columnIndex]).length,
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

        <WorkbookIssueNotice
          issues={blockingCellIssues}
          tone="blocking"
          columnNameForIssue={(columnIndex) =>
            columnNameByIndex.get(columnIndex) ?? `Column ${columnIndex + 1}`
          }
        />
        <WorkbookIssueNotice
          issues={warningCellIssues}
          tone="warning"
          columnNameForIssue={(columnIndex) =>
            columnNameByIndex.get(columnIndex) ?? `Column ${columnIndex + 1}`
          }
        />
        <ValueIssueNotice issues={previewValueIssues} phase="preview" />

        {hasBlockingParseErrors && (
          <ValueIssueNotice
            issues={parseErrors.map((err) => {
              const separatorIndex = err.indexOf(": ");
              return separatorIndex > 0
                ? { columnName: err.slice(0, separatorIndex), error: err.slice(separatorIndex + 2) }
                : { columnName: "Spreadsheet", error: err };
            })}
            phase="import"
          />
        )}

        {previews.map((preview) => (
          <MetricPreviewSection
            key={`${preview.periodId}-${preview.columnIndex}`}
            preview={preview}
            selections={duplicateSelections[preview.columnIndex]}
            onDuplicateSelection={handleDuplicateSelection}
            contextLabel={preview.periodName}
          />
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
            disabled={isPending || totalToImport === 0 || hasBlockingParseErrors || hasBlockingDiagnostics}
            className="px-4 py-2 rounded-md bg-success text-white cursor-pointer disabled:opacity-50"
          >
            {isPending
              ? "Importing..."
              : `Confirm Multi-Period Import (${totalToImport} ${totalToImport === 1 ? "entry" : "entries"})`}
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
          Choose an existing period for each detected date group, map columns to metrics using the
          detected metric identity, exclude columns explicitly, or move individual columns to a
          different target period. Multiple proposals may target the same evaluation period.
        </p>
      </div>

      {proposalStates.map((state) => {
        const proposal = proposals.find((p) => p.proposalId === state.proposalId);
        if (!proposal) return null;
        const periodSelectId = `multi-period-target-${state.proposalId}`;

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
                  <label
                    htmlFor={periodSelectId}
                    className="text-xs font-medium text-text-primary block mb-1"
                  >
                    Default target evaluation period
                  </label>
                  <select
                    id={periodSelectId}
                    value={state.targetPeriodId}
                    onChange={(e) => handlePeriodChange(state.proposalId, e.target.value)}
                    className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                  >
                    {sortedPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatPeriodLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {state.columnMappings.map((mapping) => {
                    const period = sortedPeriods.find((p) => p.id === mapping.targetPeriodId);
                    const periodMetrics = period?.metrics ?? [];
                    const attachableLibrary = attachableLibraryForPeriod(
                      mapping.targetPeriodId,
                      sortedPeriods,
                      allianceLibraryMetrics,
                    );
                    const usedElsewhere = getUsedMetricIdsForPeriod(
                      mapping.targetPeriodId,
                      mapping.columnIndex,
                    );
                    const columnPeriodSelectId = `multi-period-column-period-${state.proposalId}-${mapping.columnIndex}`;

                    return (
                      <div
                        key={mapping.columnIndex}
                        className="p-3 rounded-md border border-border bg-surface-secondary/30 space-y-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-text-primary">{mapping.columnName}</p>
                          <p className="text-xs text-text-muted">
                            Detected metric: <strong>{mapping.proposedMetricName}</strong>
                          </p>
                        </div>

                        <div>
                          <label
                            htmlFor={columnPeriodSelectId}
                            className="text-xs font-medium text-text-primary block mb-1"
                          >
                            Target period for this column
                          </label>
                          <select
                            id={columnPeriodSelectId}
                            value={mapping.targetPeriodId}
                            onChange={(e) =>
                              handleColumnPeriodChange(
                                state.proposalId,
                                mapping.columnIndex,
                                e.target.value,
                              )
                            }
                            className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                          >
                            {sortedPeriods.map((p) => (
                              <option key={p.id} value={p.id}>
                                {formatPeriodLabel(p)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <select
                          aria-label={`Metric for ${mapping.columnName}`}
                          value={mappingTargetToToken(mapping)}
                          onChange={(e) =>
                            setColumnTarget(
                              state.proposalId,
                              mapping.columnIndex,
                              e.target.value,
                              mapping.proposedMetricName,
                            )
                          }
                          className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                        >
                          <option value={UNCONFIRMED_TARGET_TOKEN}>Choose an action...</option>
                          <option value={SKIP_TARGET_TOKEN}>Do not import</option>
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
                              Create &ldquo;{mapping.proposedMetricName}&rdquo;
                            </option>
                          )}
                        </select>
                        {mapping.confirmationStatus === "unconfirmed" && (
                          <p className="text-xs text-warning">
                            Choose a metric or explicitly select Do not import.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {periodMetricCollision && (
        <div className="p-4 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm">
          {periodMetricCollision}
        </div>
      )}

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
