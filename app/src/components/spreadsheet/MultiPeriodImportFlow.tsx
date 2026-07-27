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
  qualifyingProposals,
  UNKNOWN_METRIC_IDENTITY,
} from "@/app/src/lib/import/periodProposal";
import { isDateLikeMetricIdentity } from "@/app/src/lib/import/dateHeaderParser";
import {
  buildPlannedMultiPeriodTranslationSummary,
  buildCommittedMultiPeriodTranslationSummary,
  type ColumnTarget,
} from "@/app/src/lib/importTranslation";
import type { ImportMetricTarget } from "@/app/src/lib/metricResolution";
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
import type { MultiPeriodGroupTarget } from "@/app/src/lib/import/multiPeriodImport";
import { getMetricPeriodFieldError } from "@/app/src/lib/metricPeriodValidation";

type MemberOption = { id: string; playerName: string };
type MetricOption = { id: string; name: string };

import {
  sortAlliancePeriods,
  pickSuggestedAlliancePeriod,
  type AlliancePeriodOption,
} from "@/app/src/lib/import/multiPeriodImportUi";

type ColumnConfirmationStatus = "unconfirmed" | "confirmed_skip" | "confirmed_metric";

type ColumnMetricMapping = {
  columnIndex: number;
  columnName: string;
  proposedMetricName: string;
  periodTarget: PeriodTargetState;
  /** True when the leader explicitly changed this column's period selector. */
  periodTargetExplicit: boolean;
  classification: ColumnClassification;
  target: ColumnTarget;
  confirmationStatus: ColumnConfirmationStatus;
  /** Set when a group period change invalidates a prior explicit choice. */
  invalidReason?: string;
};

type ProposalMappingState = {
  proposalId: string;
  proposalName: string;
  excluded: boolean;
  periodTarget: PeriodTargetState;
  columnMappings: ColumnMetricMapping[];
};

type MultiPeriodMetricPreview = MetricImportPreviewData & {
  proposalId: string;
  groupKey: string;
  periodTargetWire: MultiPeriodGroupTarget;
  periodName: string;
};

type DuplicateSelections = Record<number, Record<string, number>>;

type MultiPeriodImportFlowProps = {
  allianceId: string;
  routePeriodId?: string | null;
  alliancePeriods: AlliancePeriodOption[];
  /** Full active alliance metric library — attachable subsets are derived per target period. */
  allianceLibraryMetrics: MetricOption[];
  canCreateMetrics: boolean;
  canAttachMetrics: boolean;
  canConfigurePeriods: boolean;
  members: MemberOption[];
  review: PeriodMappingReview;
  /** When provided, overrides qualifyingProposals(review) — used by the guided setup route. */
  resolvedProposals?: PeriodMappingProposal[];
  parsedWorkbook: ParsedWorkbook;
  selectedSheetIndex: number;
  tableBounds: TableBoundsResult | null;
  playerColumnIndex: number;
  onCancel: () => void;
};

type FlowStep = "map" | "preview" | "complete";

/** Distinct from confirmed skip (`skip`) so native change events fire from the initial state. */
export const UNCONFIRMED_TARGET_TOKEN = "__unconfirmed__";
export const UNCONFIRMED_PERIOD_SELECT_VALUE = "__unconfirmed_period__";
export const CREATE_PERIOD_SELECT_VALUE = "__create_period__";
const SKIP_TARGET_TOKEN = "skip";

type PeriodTargetState =
  | { mode: "existing"; periodId: string }
  | { mode: "create"; name: string; startsAt: string; endsAt: string }
  | { mode: "unconfirmed" };

function metricIdentity(col: ColumnPeriodEvidence): string {
  if (col.proposedMetricName === UNKNOWN_METRIC_IDENTITY) {
    return UNKNOWN_METRIC_IDENTITY;
  }
  if (col.proposedMetricName && !isDateLikeMetricIdentity(col.proposedMetricName)) {
    return col.proposedMetricName;
  }
  if (isDateLikeMetricIdentity(col.headerText)) {
    return UNKNOWN_METRIC_IDENTITY;
  }
  return col.proposedMetricName || col.headerText;
}

function requiresExplicitMetricConfirmation(proposedMetricName: string): boolean {
  return (
    proposedMetricName === UNKNOWN_METRIC_IDENTITY ||
    isDateLikeMetricIdentity(proposedMetricName)
  );
}

function requiresExplicitCreateMetricName(
  proposedMetricName: string,
  target: ColumnTarget,
): boolean {
  return target.kind === "create" && requiresExplicitMetricConfirmation(proposedMetricName);
}

function proposalRequiresExplicitMapping(
  proposal: PeriodMappingProposal,
  routePeriodId: string | null | undefined,
): boolean {
  return (
    proposal.source === "unassigned" ||
    (routePeriodId == null && proposal.source === "manual_fallback")
  );
}

function reconcileColumnMappingForPeriodChange(
  mapping: ColumnMetricMapping,
  nextPeriodTarget: PeriodTargetState,
  sortedPeriods: AlliancePeriodOption[],
  allianceLibraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
): ColumnMetricMapping {
  const nextMapping: ColumnMetricMapping = {
    ...mapping,
    periodTarget: nextPeriodTarget,
    invalidReason: undefined,
  };

  if (mapping.confirmationStatus === "unconfirmed") {
    return nextMapping;
  }

  if (mapping.confirmationStatus === "confirmed_skip") {
    return {
      ...nextMapping,
      confirmationStatus: "confirmed_skip",
      target: { kind: "skip" },
    };
  }

  const { periodMetrics, attachableLibrary } = resolvePeriodContext(
    nextPeriodTarget,
    sortedPeriods,
    allianceLibraryMetrics,
  );

  if (mapping.target.kind === "create") {
    if (!mapping.target.name.trim()) {
      return {
        ...nextMapping,
        confirmationStatus: "unconfirmed",
        target: mapping.target,
      };
    }
    return {
      ...nextMapping,
      confirmationStatus: "confirmed_metric",
      target: mapping.target,
    };
  }

  if (mapping.target.kind === "existing") {
    const existingTarget = mapping.target;
    const stillAttached = periodMetrics.some((metric) => metric.id === existingTarget.metricId);
    if (stillAttached) {
      return {
        ...nextMapping,
        confirmationStatus: "confirmed_metric",
        target: mapping.target,
      };
    }
    const attachableOnNewPeriod =
      canAttachMetrics &&
      attachableLibrary.some((metric) => metric.id === existingTarget.metricId);
    if (attachableOnNewPeriod) {
      return {
        ...nextMapping,
        confirmationStatus: "confirmed_metric",
        target: { kind: "attach", metricId: existingTarget.metricId },
      };
    }
    return {
      ...nextMapping,
      confirmationStatus: "unconfirmed",
      target: { kind: "skip" },
      invalidReason:
        "The previously selected metric is not attached to the new target period. Choose a metric again.",
    };
  }

  if (mapping.target.kind === "attach") {
    const attachTarget = mapping.target;
    const alreadyOnPeriod = periodMetrics.some((metric) => metric.id === attachTarget.metricId);
    if (alreadyOnPeriod) {
      return {
        ...nextMapping,
        confirmationStatus: "confirmed_metric",
        target: { kind: "existing", metricId: attachTarget.metricId },
      };
    }
    const stillAttachable =
      canAttachMetrics && attachableLibrary.some((metric) => metric.id === attachTarget.metricId);
    if (stillAttachable) {
      return {
        ...nextMapping,
        confirmationStatus: "confirmed_metric",
        target: mapping.target,
      };
    }
    return {
      ...nextMapping,
      confirmationStatus: "unconfirmed",
      target: { kind: "skip" },
      invalidReason:
        "The previously selected library metric is not available for the new target period. Choose a metric again.",
    };
  }

  return nextMapping;
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

function createPeriodTargetFromProposal(proposal: PeriodMappingProposal): PeriodTargetState {
  return {
    mode: "create",
    name: proposal.proposedPeriodName,
    startsAt: proposal.startsAtISO?.slice(0, 10) ?? "",
    endsAt: proposal.endsAtISO?.slice(0, 10) ?? "",
  };
}

function periodTargetToSelectValue(target: PeriodTargetState): string {
  if (target.mode === "unconfirmed") {
    return UNCONFIRMED_PERIOD_SELECT_VALUE;
  }
  return target.mode === "existing" ? target.periodId : CREATE_PERIOD_SELECT_VALUE;
}

function periodTargetGroupKey(target: PeriodTargetState): string {
  if (target.mode === "unconfirmed") {
    return "unconfirmed";
  }
  if (target.mode === "existing") {
    return `existing:${target.periodId}`;
  }
  return `create:${target.name.trim().toLowerCase()}:${target.startsAt}:${target.endsAt}`;
}

function periodTargetToWireTarget(target: PeriodTargetState): MultiPeriodGroupTarget {
  if (target.mode === "unconfirmed") {
    throw new Error("Cannot wire an unconfirmed period target");
  }
  if (target.mode === "existing") {
    return { kind: "existing", periodId: target.periodId };
  }
  return {
    kind: "create",
    name: target.name.trim(),
    startsAt: target.startsAt || null,
    endsAt: target.endsAt || null,
  };
}

function resolvePeriodContext(
  periodTarget: PeriodTargetState,
  sortedPeriods: AlliancePeriodOption[],
  allianceLibraryMetrics: MetricOption[],
): {
  periodMetrics: MetricOption[];
  attachableLibrary: MetricOption[];
  displayName: string;
} {
  if (periodTarget.mode === "unconfirmed") {
    return {
      periodMetrics: [],
      attachableLibrary: [],
      displayName: "Choose target period",
    };
  }

  if (periodTarget.mode === "existing") {
    const period = sortedPeriods.find((item) => item.id === periodTarget.periodId);
    return {
      periodMetrics: period?.metrics ?? [],
      attachableLibrary: attachableLibraryForPeriod(
        periodTarget.periodId,
        sortedPeriods,
        allianceLibraryMetrics,
      ),
      displayName: period?.name ?? "Period",
    };
  }

  return {
    periodMetrics: [],
    attachableLibrary: allianceLibraryMetrics,
    displayName: periodTarget.name.trim() || "New evaluation period",
  };
}

function parsePeriodSelectValue(
  value: string,
  proposal: PeriodMappingProposal,
): PeriodTargetState {
  if (value === UNCONFIRMED_PERIOD_SELECT_VALUE) {
    return { mode: "unconfirmed" };
  }
  if (value === CREATE_PERIOD_SELECT_VALUE) {
    if (proposal.source === "unassigned" || proposal.source === "manual_fallback") {
      return { mode: "create", name: "", startsAt: "", endsAt: "" };
    }
    return createPeriodTargetFromProposal(proposal);
  }
  return { mode: "existing", periodId: value };
}

function createTargetFieldInput(
  target: Extract<PeriodTargetState, { mode: "create" }>,
): { name: string; startsAt: string | null; endsAt: string | null } {
  return {
    name: target.name,
    startsAt: target.startsAt || null,
    endsAt: target.endsAt || null,
  };
}

function shouldShowColumnCreateFields(
  mapping: ColumnMetricMapping,
  columnMappings: ColumnMetricMapping[],
): boolean {
  if (mapping.periodTarget.mode !== "create" || !mapping.periodTargetExplicit) {
    return false;
  }

  const groupKey = periodTargetGroupKey(mapping.periodTarget);
  const explicitCreatesInGroup = columnMappings.filter(
    (item) =>
      item.periodTarget.mode === "create" &&
      item.periodTargetExplicit &&
      periodTargetGroupKey(item.periodTarget) === groupKey,
  );
  const ownerColumnIndex = Math.min(...explicitCreatesInGroup.map((item) => item.columnIndex));
  return mapping.columnIndex === ownerColumnIndex;
}

function mappingTargetToToken(mapping: ColumnMetricMapping): string {
  if (mapping.target.kind === "create") {
    return "create";
  }
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
  if (token === "create") {
    return {
      kind: "create",
      name: requiresExplicitMetricConfirmation(proposedMetricName) ? "" : proposedMetricName,
    };
  }
  const [kind, metricId] = token.split(":");
  if (kind === "existing" && metricId) return { kind: "existing", metricId };
  if (kind === "attach" && metricId) return { kind: "attach", metricId };
  return { kind: "skip" };
}

function toWireTarget(target: ColumnTarget): ImportMetricTarget {
  if (target.kind === "create") return { kind: "create", name: target.name };
  if (target.kind === "attach") return { kind: "attach", metricId: target.metricId };
  if (target.kind === "existing") return { kind: "existing", metricId: target.metricId };
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

    const periodCollisions = byPeriod.get(periodTargetGroupKey(mapping.periodTarget)) ?? new Map<string, string>();
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
    byPeriod.set(periodTargetGroupKey(mapping.periodTarget), periodCollisions);
  }

  return null;
}

function buildColumnMappingsForProposal(
  columns: ColumnPeriodEvidence[],
  periodTarget: PeriodTargetState,
  sortedPeriods: AlliancePeriodOption[],
  allianceLibraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
  autoConfirmMetrics = true,
): ColumnMetricMapping[] {
  const { periodMetrics, attachableLibrary } = resolvePeriodContext(
    periodTarget,
    sortedPeriods,
    allianceLibraryMetrics,
  );
  const usedMetricIds = new Set<string>();
  return columns.map((col) => {
    const proposedMetricName = metricIdentity(col);
    const classification = classifyColumn({
      columnIndex: col.columnIndex,
      columnName: proposedMetricName,
      periodMetrics,
      libraryMetrics: attachableLibrary,
    });

    if (!autoConfirmMetrics || requiresExplicitMetricConfirmation(proposedMetricName)) {
      return {
        columnIndex: col.columnIndex,
        columnName: col.headerText,
        proposedMetricName,
        periodTarget,
        periodTargetExplicit: false,
        classification,
        target: { kind: "skip" },
        confirmationStatus: "unconfirmed",
      };
    }

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
        periodTarget,
        periodTargetExplicit: false,
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
        periodTarget,
        periodTargetExplicit: false,
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
        periodTarget,
        periodTargetExplicit: false,
        classification,
        target: { kind: "create", name: proposedMetricName },
        confirmationStatus: "confirmed_metric",
      };
    }

    return {
      columnIndex: col.columnIndex,
      columnName: col.headerText,
      proposedMetricName,
      periodTarget,
      periodTargetExplicit: false,
      classification,
      target: { kind: "skip" },
      confirmationStatus: "unconfirmed",
    };
  });
}

function defaultPeriodTargetForProposal(
  proposal: PeriodMappingProposal,
  sortedPeriods: AlliancePeriodOption[],
  routePeriodId: string | null | undefined,
): PeriodTargetState {
  if (routePeriodId) {
    const routePeriod = sortedPeriods.find((period) => period.id === routePeriodId);
    if (routePeriod) {
      return { mode: "existing", periodId: routePeriod.id };
    }
  }

  // Guided setup route: detected proposals derive create targets from evidence,
  // not the latest active period.
  if (routePeriodId == null && proposal.source === "detected") {
    return createPeriodTargetFromProposal(proposal);
  }

  // Supplemental mixed-confidence columns stay unassigned until the leader chooses.
  if (
    proposal.source === "unassigned" ||
    (routePeriodId == null && proposal.source === "manual_fallback")
  ) {
    return { mode: "unconfirmed" };
  }

  const suggestedPeriod = pickSuggestedAlliancePeriod(sortedPeriods);
  if (suggestedPeriod) {
    return { mode: "existing", periodId: suggestedPeriod.id };
  }

  if (proposal.source === "manual_fallback") {
    return { mode: "create", name: "", startsAt: "", endsAt: "" };
  }

  return createPeriodTargetFromProposal(proposal);
}

function initialProposalStates(
  proposals: PeriodMappingProposal[],
  sortedPeriods: AlliancePeriodOption[],
  routePeriodId: string | null | undefined,
  allianceLibraryMetrics: MetricOption[],
  canAttachMetrics: boolean,
  canCreateMetrics: boolean,
): ProposalMappingState[] {
  return proposals.map((proposal) => {
    const periodTarget = defaultPeriodTargetForProposal(
      proposal,
      sortedPeriods,
      routePeriodId,
    );

    return {
      proposalId: proposal.proposalId,
      proposalName: proposal.proposedPeriodName || "Manual import",
      excluded: false,
      periodTarget,
      columnMappings: buildColumnMappingsForProposal(
        proposal.columns,
        periodTarget,
        sortedPeriods,
        allianceLibraryMetrics,
        canAttachMetrics,
        canCreateMetrics,
        !proposalRequiresExplicitMapping(proposal, routePeriodId),
      ),
    };
  });
}

function requiresConfigurePeriodsPermission(
  proposals: PeriodMappingProposal[],
  sortedPeriods: AlliancePeriodOption[],
  routePeriodId: string | null | undefined,
): boolean {
  if (sortedPeriods.length === 0) {
    return true;
  }

  return proposals.some((proposal) => {
    const target = defaultPeriodTargetForProposal(proposal, sortedPeriods, routePeriodId);
    return target.mode === "create";
  });
}

function allActiveColumnMappings(states: ProposalMappingState[]): ColumnMetricMapping[] {
  return states.filter((s) => !s.excluded).flatMap((s) => s.columnMappings);
}

export function MultiPeriodImportFlow({
  allianceId,
  routePeriodId = null,
  alliancePeriods,
  allianceLibraryMetrics,
  canCreateMetrics,
  canAttachMetrics,
  canConfigurePeriods,
  members,
  review,
  resolvedProposals,
  parsedWorkbook,
  selectedSheetIndex,
  tableBounds,
  playerColumnIndex,
  onCancel,
}: MultiPeriodImportFlowProps) {
  const router = useRouter();
  const sortedPeriods = useMemo(() => sortAlliancePeriods(alliancePeriods), [alliancePeriods]);
  const proposals = useMemo(
    () => resolvedProposals ?? qualifyingProposals(review),
    [resolvedProposals, review],
  );
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

  const handlePeriodChange = (proposalId: string, selectValue: string) => {
    const proposal = proposals.find((item) => item.proposalId === proposalId);
    if (!proposal) return;
    const periodTarget = parsePeriodSelectValue(selectValue, proposal);

    updateProposalState(proposalId, (state) => ({
      ...state,
      periodTarget,
      columnMappings: state.columnMappings.map((mapping) =>
        reconcileColumnMappingForPeriodChange(
          mapping,
          periodTarget,
          sortedPeriods,
          allianceLibraryMetrics,
          canAttachMetrics,
        ),
      ),
    }));
  };

  const handleCreatePeriodFieldChange = (
    proposalId: string,
    field: "name" | "startsAt" | "endsAt",
    value: string,
  ) => {
    updateProposalState(proposalId, (state) => {
      if (state.periodTarget.mode !== "create") return state;
      const nextTarget: PeriodTargetState = {
        ...state.periodTarget,
        [field]: value,
      };
      return {
        ...state,
        periodTarget: nextTarget,
        columnMappings: state.columnMappings.map((mapping) => ({
          ...mapping,
          periodTarget: nextTarget,
        })),
      };
    });
  };

  const handleColumnPeriodChange = (
    proposalId: string,
    columnIndex: number,
    selectValue: string,
  ) => {
    const proposal = proposals.find((item) => item.proposalId === proposalId);
    const col = proposal?.columns.find((column) => column.columnIndex === columnIndex);
    if (!proposal || !col) return;
    const periodTarget = parsePeriodSelectValue(selectValue, proposal);

    updateProposalState(proposalId, (state) => ({
      ...state,
      columnMappings: state.columnMappings.map((mapping) => {
        if (mapping.columnIndex !== columnIndex) return mapping;
        const rebuilt = buildColumnMappingsForProposal(
          [col],
          periodTarget,
          sortedPeriods,
          allianceLibraryMetrics,
          canAttachMetrics,
          canCreateMetrics,
          !proposalRequiresExplicitMapping(proposal, routePeriodId),
        )[0];
        return {
          ...rebuilt,
          periodTarget,
          periodTargetExplicit: true,
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

  const handleColumnCreatePeriodFieldChange = (
    proposalId: string,
    columnIndex: number,
    field: "name" | "startsAt" | "endsAt",
    value: string,
  ) => {
    updateProposalState(proposalId, (state) => {
      const owner = state.columnMappings.find((mapping) => mapping.columnIndex === columnIndex);
      if (!owner || owner.periodTarget.mode !== "create") {
        return state;
      }

      const preEditGroupKey = periodTargetGroupKey(owner.periodTarget);
      const nextTarget: PeriodTargetState = {
        ...owner.periodTarget,
        [field]: value,
      };

      return {
        ...state,
        columnMappings: state.columnMappings.map((mapping) => {
          if (
            mapping.periodTarget.mode !== "create" ||
            !mapping.periodTargetExplicit ||
            periodTargetGroupKey(mapping.periodTarget) !== preEditGroupKey
          ) {
            return mapping;
          }
          return {
            ...mapping,
            periodTarget: nextTarget,
          };
        }),
      };
    });
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
        if (token === UNCONFIRMED_TARGET_TOKEN) {
          return {
            ...m,
            target: { kind: "skip" as const },
            confirmationStatus: "unconfirmed" as const,
          };
        }
        const target = tokenToTarget(token, proposedMetricName);
        const confirmationStatus: ColumnConfirmationStatus =
          target.kind === "skip"
            ? "confirmed_skip"
            : target.kind === "create" && !target.name.trim()
              ? "unconfirmed"
              : "confirmed_metric";
        return { ...m, target, confirmationStatus, invalidReason: undefined };
      }),
    }));
  };

  const handleColumnCreateMetricNameChange = (
    proposalId: string,
    columnIndex: number,
    name: string,
  ) => {
    updateProposalState(proposalId, (state) => ({
      ...state,
      columnMappings: state.columnMappings.map((mapping) => {
        if (mapping.columnIndex !== columnIndex || mapping.target.kind !== "create") {
          return mapping;
        }
        const nextTarget = { ...mapping.target, name };
        return {
          ...mapping,
          target: nextTarget,
          confirmationStatus: name.trim() ? "confirmed_metric" : "unconfirmed",
          invalidReason: undefined,
        };
      }),
    }));
  };

  const getUsedMetricIdsForPeriod = (periodKey: string, excludeColumnIndex: number) =>
    new Set(
      activeColumnMappings
        .filter(
          (mapping) =>
            periodTargetGroupKey(mapping.periodTarget) === periodKey &&
            mapping.columnIndex !== excludeColumnIndex &&
            mapping.confirmationStatus === "confirmed_metric" &&
            (mapping.target.kind === "existing" || mapping.target.kind === "attach"),
        )
        .flatMap((mapping) =>
          mapping.target.kind === "existing" || mapping.target.kind === "attach"
            ? [mapping.target.metricId]
            : [],
        ),
    );

  const invalidCreatePeriodNames = activeColumnMappings.some(
    (mapping) =>
      mapping.confirmationStatus === "confirmed_metric" &&
      mapping.target.kind !== "skip" &&
      mapping.periodTarget.mode === "create" &&
      !mapping.periodTarget.name.trim(),
  );

  const hasBlankCreateMetricNames = activeColumnMappings.some(
    (mapping) => mapping.target.kind === "create" && !mapping.target.name.trim(),
  );

  const activeCreateTargets = useMemo(() => {
    const byKey = new Map<string, Extract<PeriodTargetState, { mode: "create" }>>();
    for (const mapping of activeColumnMappings) {
      if (
        mapping.confirmationStatus !== "confirmed_metric" ||
        mapping.target.kind === "skip" ||
        mapping.periodTarget.mode !== "create"
      ) {
        continue;
      }
      byKey.set(periodTargetGroupKey(mapping.periodTarget), mapping.periodTarget);
    }
    return [...byKey.values()];
  }, [activeColumnMappings]);

  const createTargetErrors = useMemo(
    () =>
      new Map(
        activeCreateTargets.map((target) => [
          periodTargetGroupKey(target),
          getMetricPeriodFieldError(createTargetFieldInput(target)),
        ]),
      ),
    [activeCreateTargets],
  );

  const hasInvalidCreatePeriodFields = [...createTargetErrors.values()].some(Boolean);

  const allColumnsConfirmed = activeStates.every((state) =>
    state.columnMappings.every(
      (m) => m.confirmationStatus === "confirmed_metric" || m.confirmationStatus === "confirmed_skip",
    ),
  );

  const hasConfirmedMetricImport = activeColumnMappings.some(
    (m) => m.confirmationStatus === "confirmed_metric" && m.target.kind !== "skip",
  );

  const hasUnconfirmedPeriodTarget =
    activeStates.some((state) => state.periodTarget.mode === "unconfirmed") ||
    activeColumnMappings.some((mapping) => mapping.periodTarget.mode === "unconfirmed");

  const canProceedToPreview =
    activeStates.length > 0 &&
    allColumnsConfirmed &&
    hasConfirmedMetricImport &&
    !periodMetricCollision &&
    !invalidCreatePeriodNames &&
    !hasInvalidCreatePeriodFields &&
    !hasUnconfirmedPeriodTarget &&
    !hasBlankCreateMetricNames;

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
        const periodContext = resolvePeriodContext(
          mapping.periodTarget,
          sortedPeriods,
          allianceLibraryMetrics,
        );

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
          groupKey: periodTargetGroupKey(mapping.periodTarget),
          periodTargetWire: periodTargetToWireTarget(mapping.periodTarget),
          periodName: periodContext.displayName,
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
        target: MultiPeriodGroupTarget;
        mappings: Parameters<typeof importMultiPeriodMetrics>[0]["groups"][number]["mappings"];
      }
    >();

    for (const preview of previews) {
      const entries = getPreviewEntries(preview, duplicateSelections[preview.columnIndex]);
      if (entries.length === 0) continue;

      if (!groupsMap.has(preview.groupKey)) {
        groupsMap.set(preview.groupKey, {
          target: preview.periodTargetWire,
          mappings: [],
        });
      }

      groupsMap.get(preview.groupKey)!.mappings.push({
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
  const selectedRegion = tableBounds
    ? tableBounds.tableRegions[tableBounds.selectedRegionIndex]
    : undefined;
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

  const blockedByPeriodPermission =
    !canConfigurePeriods &&
    requiresConfigurePeriodsPermission(proposals, sortedPeriods, routePeriodId);

  if (step === "complete" && importResult) {
    const committed = buildCommittedMultiPeriodTranslationSummary({ result: importResult });
    const committedPeriods = importResult.periods;

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
        <div className="flex flex-wrap gap-3 justify-end">
          {committedPeriods.length === 1 ? (
            <>
              <Link
                href={`/alliances/${allianceId}/members?periodId=${committedPeriods[0]!.periodId}`}
                className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover text-sm font-medium"
              >
                View Member Results
              </Link>
              <Link
                href={`/alliances/${allianceId}/periods/${committedPeriods[0]!.periodId}`}
                className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary text-sm font-medium"
              >
                View Evaluation Period
              </Link>
            </>
          ) : (
            <>
              {committedPeriods.map((period) => (
                <Link
                  key={period.periodId}
                  href={`/alliances/${allianceId}/members?periodId=${period.periodId}`}
                  className="px-4 py-2 rounded-md border border-border text-text-primary hover:bg-surface-secondary text-sm font-medium"
                >
                  View Results — {period.periodName}
                </Link>
              ))}
              <Link
                href={`/alliances/${allianceId}/members`}
                className="px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-hover text-sm font-medium"
              >
                View Members
              </Link>
              <Link
                href={`/alliances/${allianceId}/periods`}
                className="px-4 py-2 rounded-md border border-primary/40 bg-primary/10 text-primary-light hover:bg-primary/20 text-sm font-medium"
              >
                View Evaluation Periods
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  if (blockedByPeriodPermission) {
    return (
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="p-6 rounded-lg bg-surface-secondary border border-border space-y-3">
          <h3 className="text-lg font-semibold text-text-primary">
            Evaluation period configuration required
          </h3>
          <p className="text-sm text-text-secondary">
            This import needs a new evaluation period, but your role cannot create or configure
            periods. Ask an Admin or Owner to create an evaluation period first, or import into an
            existing period if one is available.
          </p>
          {sortedPeriods.length === 0 && (
            <p className="text-sm text-text-muted">
              No active evaluation periods exist for this alliance yet.
            </p>
          )}
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-border cursor-pointer"
          >
            Back
          </button>
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
      previews.map((preview) => [
        preview.groupKey,
        {
          periodId: preview.groupKey,
          periodName: preview.periodName,
          mappedColumnsCount: previews.filter((item) => item.groupKey === preview.groupKey).length,
          totalEntriesCount: previews
            .filter((item) => item.groupKey === preview.groupKey)
            .reduce(
              (sum, item) =>
                sum + getPreviewEntries(item, duplicateSelections[item.columnIndex]).length,
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
            key={`${preview.groupKey}-${preview.columnIndex}`}
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
        <p className="font-medium text-text-primary">
          Map proposals to evaluation periods
        </p>
        <p className="text-text-secondary text-xs mt-1">
          Choose an existing period or create a new one for each detected date group, map columns
          to metrics using the detected metric identity, exclude columns explicitly, or move
          individual columns to a different target period. Multiple proposals may target the same
          evaluation period.
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

            {proposal.warnings.length > 0 && (
              <div className="p-3 rounded-md bg-warning/10 border border-warning/30 text-xs text-text-secondary space-y-1">
                {proposal.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

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
                    value={periodTargetToSelectValue(state.periodTarget)}
                    onChange={(e) => handlePeriodChange(state.proposalId, e.target.value)}
                    className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                  >
                    {(proposal.source === "unassigned" ||
                      (routePeriodId == null && proposal.source === "manual_fallback")) && (
                      <option value={UNCONFIRMED_PERIOD_SELECT_VALUE}>
                        Choose a target period...
                      </option>
                    )}
                    {sortedPeriods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {formatPeriodLabel(period)}
                      </option>
                    ))}
                    {canConfigurePeriods && (
                      <option value={CREATE_PERIOD_SELECT_VALUE}>
                        Create new evaluation period
                      </option>
                    )}
                  </select>
                </div>

                {state.periodTarget.mode === "create" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-3">
                      <label
                        htmlFor={`${periodSelectId}-name`}
                        className="text-xs font-medium text-text-primary block mb-1"
                      >
                        New period name
                      </label>
                      <input
                        id={`${periodSelectId}-name`}
                        type="text"
                        value={state.periodTarget.name}
                        onChange={(e) =>
                          handleCreatePeriodFieldChange(state.proposalId, "name", e.target.value)
                        }
                        className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                      />
                      {!state.periodTarget.name.trim() && (
                        <p className="text-xs text-warning mt-1">Name is required.</p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor={`${periodSelectId}-starts-at`}
                        className="text-xs font-medium text-text-primary block mb-1"
                      >
                        Start date
                      </label>
                      <input
                        id={`${periodSelectId}-starts-at`}
                        type="date"
                        value={state.periodTarget.startsAt}
                        onChange={(e) =>
                          handleCreatePeriodFieldChange(
                            state.proposalId,
                            "startsAt",
                            e.target.value,
                          )
                        }
                        className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${periodSelectId}-ends-at`}
                        className="text-xs font-medium text-text-primary block mb-1"
                      >
                        End date
                      </label>
                      <input
                        id={`${periodSelectId}-ends-at`}
                        type="date"
                        value={state.periodTarget.endsAt}
                        onChange={(e) =>
                          handleCreatePeriodFieldChange(state.proposalId, "endsAt", e.target.value)
                        }
                        className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                      />
                    </div>
                    {createTargetErrors.get(periodTargetGroupKey(state.periodTarget)) && (
                      <p className="text-xs text-warning sm:col-span-3">
                        {createTargetErrors.get(periodTargetGroupKey(state.periodTarget))}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {state.columnMappings.map((mapping) => {
                    const periodContext = resolvePeriodContext(
                      mapping.periodTarget,
                      sortedPeriods,
                      allianceLibraryMetrics,
                    );
                    const usedElsewhere = getUsedMetricIdsForPeriod(
                      periodTargetGroupKey(mapping.periodTarget),
                      mapping.columnIndex,
                    );
                    const columnPeriodSelectId = `multi-period-column-period-${state.proposalId}-${mapping.columnIndex}`;
                    const { periodMetrics, attachableLibrary } = periodContext;
                    const columnCreateTarget =
                      mapping.periodTarget.mode === "create" &&
                      shouldShowColumnCreateFields(mapping, state.columnMappings)
                        ? mapping.periodTarget
                        : null;
                    const columnCreateTargetError = columnCreateTarget
                      ? createTargetErrors.get(periodTargetGroupKey(columnCreateTarget))
                      : null;

                    const columnCreateMetricTarget =
                      mapping.target.kind === "create" &&
                      requiresExplicitCreateMetricName(
                        mapping.proposedMetricName,
                        mapping.target,
                      )
                        ? mapping.target
                        : null;
                    const metricNameIsBlank = columnCreateMetricTarget
                      ? !columnCreateMetricTarget.name.trim()
                      : false;
                    const metricNameErrorId = `multi-period-metric-name-error-${state.proposalId}-${mapping.columnIndex}`;

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
                            value={periodTargetToSelectValue(mapping.periodTarget)}
                            onChange={(e) =>
                              handleColumnPeriodChange(
                                state.proposalId,
                                mapping.columnIndex,
                                e.target.value,
                              )
                            }
                            className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                          >
                            {(proposal.source === "unassigned" ||
                              (routePeriodId == null &&
                                proposal.source === "manual_fallback")) && (
                              <option value={UNCONFIRMED_PERIOD_SELECT_VALUE}>
                                Choose a target period...
                              </option>
                            )}
                            {sortedPeriods.map((period) => (
                              <option key={period.id} value={period.id}>
                                {formatPeriodLabel(period)}
                              </option>
                            ))}
                            {canConfigurePeriods && (
                              <option value={CREATE_PERIOD_SELECT_VALUE}>
                                Create new evaluation period
                              </option>
                            )}
                          </select>
                        </div>

                        {columnCreateTarget && (
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="sm:col-span-3">
                              <label
                                htmlFor={`${columnPeriodSelectId}-name`}
                                className="text-xs font-medium text-text-primary block mb-1"
                              >
                                New period name
                              </label>
                              <input
                                id={`${columnPeriodSelectId}-name`}
                                type="text"
                                value={columnCreateTarget.name}
                                onChange={(e) =>
                                  handleColumnCreatePeriodFieldChange(
                                    state.proposalId,
                                    mapping.columnIndex,
                                    "name",
                                    e.target.value,
                                  )
                                }
                                className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                              />
                              {!columnCreateTarget.name.trim() && (
                                <p className="text-xs text-warning mt-1">Name is required.</p>
                              )}
                            </div>
                            <div>
                              <label
                                htmlFor={`${columnPeriodSelectId}-starts-at`}
                                className="text-xs font-medium text-text-primary block mb-1"
                              >
                                Start date
                              </label>
                              <input
                                id={`${columnPeriodSelectId}-starts-at`}
                                type="date"
                                value={columnCreateTarget.startsAt}
                                onChange={(e) =>
                                  handleColumnCreatePeriodFieldChange(
                                    state.proposalId,
                                    mapping.columnIndex,
                                    "startsAt",
                                    e.target.value,
                                  )
                                }
                                className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`${columnPeriodSelectId}-ends-at`}
                                className="text-xs font-medium text-text-primary block mb-1"
                              >
                                End date
                              </label>
                              <input
                                id={`${columnPeriodSelectId}-ends-at`}
                                type="date"
                                value={columnCreateTarget.endsAt}
                                onChange={(e) =>
                                  handleColumnCreatePeriodFieldChange(
                                    state.proposalId,
                                    mapping.columnIndex,
                                    "endsAt",
                                    e.target.value,
                                  )
                                }
                                className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                              />
                            </div>
                            {columnCreateTargetError && (
                              <p className="text-xs text-warning sm:col-span-3">
                                {columnCreateTargetError}
                              </p>
                            )}
                          </div>
                        )}

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
                              {requiresExplicitMetricConfirmation(mapping.proposedMetricName)
                                ? "Create new metric (enter name below)"
                                : `Create "${mapping.proposedMetricName}"`}
                            </option>
                          )}
                        </select>
                        {columnCreateMetricTarget && (
                          <div>
                            <label
                              htmlFor={`multi-period-metric-name-${state.proposalId}-${mapping.columnIndex}`}
                              className="text-xs font-medium text-text-primary block mb-1"
                            >
                              New metric name
                            </label>
                            <input
                              id={`multi-period-metric-name-${state.proposalId}-${mapping.columnIndex}`}
                              type="text"
                              required
                              aria-required="true"
                              aria-invalid={metricNameIsBlank}
                              aria-describedby={metricNameIsBlank ? metricNameErrorId : undefined}
                              value={columnCreateMetricTarget.name}
                              onChange={(e) =>
                                handleColumnCreateMetricNameChange(
                                  state.proposalId,
                                  mapping.columnIndex,
                                  e.target.value,
                                )
                              }
                              aria-label={`New metric name for ${mapping.columnName}`}
                              className="w-full rounded-md border border-border p-2 text-sm bg-surface"
                            />
                            {metricNameIsBlank && (
                              <p id={metricNameErrorId} className="text-xs text-warning mt-1">
                                Metric name is required.
                              </p>
                            )}
                          </div>
                        )}
                        {mapping.invalidReason && (
                          <p className="text-xs text-warning">{mapping.invalidReason}</p>
                        )}
                        {mapping.confirmationStatus === "unconfirmed" &&
                          mapping.target.kind !== "create" &&
                          !mapping.invalidReason && (
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
