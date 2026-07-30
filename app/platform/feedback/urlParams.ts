import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import { isFeedbackCategory } from "@/app/src/lib/feedbackCategory";
import { boundBetaParticipantsInput } from "@/app/src/lib/platform/betaParticipants";
import type { FeedbackInboxFilters } from "@/app/src/lib/platform/feedbackInbox";

const VALID_TRIAGE_STATUSES = new Set<FeedbackTriageStatus>([
  "NEW",
  "TRIAGED",
  "PLANNED",
  "RESOLVED",
  "DISMISSED",
]);

export type FeedbackPageSearchParams = {
  status?: string;
  category?: string;
  allianceId?: string;
  participantId?: string;
  wave?: string;
  needsResponse?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) ? parsed : 1;
}

function parsePageSizeParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 25;
  return Number.isFinite(parsed) ? parsed : 25;
}

function parseNeedsResponseParam(
  raw: string | undefined,
): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export function parseFeedbackPageParams(
  params: FeedbackPageSearchParams,
): {
  filters: FeedbackInboxFilters;
  page: number;
  pageSize: number;
} {
  const status = VALID_TRIAGE_STATUSES.has(params.status as FeedbackTriageStatus)
    ? (params.status as FeedbackTriageStatus)
    : undefined;

  const category = params.category && isFeedbackCategory(params.category)
    ? params.category
    : undefined;

  return {
    filters: {
      status,
      category,
      allianceId: params.allianceId
        ? boundBetaParticipantsInput(params.allianceId)
        : undefined,
      participantId: params.participantId
        ? boundBetaParticipantsInput(params.participantId)
        : undefined,
      wave: params.wave ? boundBetaParticipantsInput(params.wave) : undefined,
      needsResponse: parseNeedsResponseParam(params.needsResponse),
      search: params.search
        ? boundBetaParticipantsInput(params.search)
        : undefined,
    },
    page: parsePageParam(params.page),
    pageSize: parsePageSizeParam(params.pageSize),
  };
}

export type FeedbackUrlState = FeedbackPageSearchParams;

export function buildFeedbackHref(
  current: FeedbackUrlState,
  updates: Partial<FeedbackUrlState> & {
    clearStatus?: boolean;
    clearNeedsResponse?: boolean;
    toggleStatus?: FeedbackTriageStatus;
    toggleNeedsResponse?: boolean;
  },
): string {
  const next: FeedbackUrlState = { ...current };

  if (updates.clearStatus) {
    delete next.status;
    delete next.needsResponse;
  }

  if (updates.toggleStatus !== undefined) {
    if (next.status === updates.toggleStatus) {
      delete next.status;
    } else {
      next.status = updates.toggleStatus;
    }
  }

  if (updates.toggleNeedsResponse !== undefined) {
    const target = updates.toggleNeedsResponse ? "true" : "true";
    if (next.needsResponse === target) {
      delete next.needsResponse;
    } else {
      next.needsResponse = target;
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (
      key === "clearStatus" ||
      key === "clearNeedsResponse" ||
      key === "toggleStatus" ||
      key === "toggleNeedsResponse"
    ) {
      continue;
    }
    const paramKey = key as keyof FeedbackUrlState;
    if (typeof value !== "string" || value === "") {
      delete next[paramKey];
    } else {
      next[paramKey] = value;
    }
  }

  if (!("page" in updates)) {
    delete next.page;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/platform/feedback?${query}` : "/platform/feedback";
}

/** Serialize current filter state for client filter navigation. */
export function feedbackFiltersToUrlState(
  filters: FeedbackInboxFilters,
  page: number,
  pageSize: number,
): FeedbackUrlState {
  return {
    status: filters.status,
    category: filters.category,
    allianceId: filters.allianceId,
    participantId: filters.participantId,
    wave: filters.wave,
    needsResponse:
      filters.needsResponse === undefined
        ? undefined
        : filters.needsResponse
          ? "true"
          : "false",
    search: filters.search,
    page: page > 1 ? String(page) : undefined,
    pageSize: pageSize !== 25 ? String(pageSize) : undefined,
  };
}
