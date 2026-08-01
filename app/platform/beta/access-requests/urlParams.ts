import type { AccessRequestTriageStatus } from "@/app/generated/prisma/enums";
import { boundBetaParticipantsInput } from "@/app/src/lib/platform/betaParticipants";
import type { AccessRequestInboxFilters } from "@/app/src/lib/platform/accessRequestInbox";

const VALID_STATUSES = new Set<AccessRequestTriageStatus>([
  "PENDING",
  "INVITED",
  "DECLINED",
  "RESOLVED_EXISTING_ACCESS",
]);

const DEFAULT_PAGE_SIZE = 20;

export type AccessRequestPageSearchParams = {
  status?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  // The read model clamps page to >= 1 server-side regardless; clamping here
  // too keeps the URL/UI (pagination links, filter state) from reflecting an
  // invalid value like `?page=0` that would silently mismatch what's shown.
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
}

function parsePageSizeParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PAGE_SIZE;
  // Same rationale as parsePageParam — the read model clamps pageSize
  // server-side too, but the URL/UI shouldn't persist a nonsensical value.
  return Number.isFinite(parsed) ? Math.max(1, parsed) : DEFAULT_PAGE_SIZE;
}

export function parseAccessRequestPageParams(
  params: AccessRequestPageSearchParams,
): {
  filters: AccessRequestInboxFilters;
  page: number;
  pageSize: number;
} {
  const status = VALID_STATUSES.has(params.status as AccessRequestTriageStatus)
    ? (params.status as AccessRequestTriageStatus)
    : undefined;

  return {
    filters: {
      status,
      search: params.search ? boundBetaParticipantsInput(params.search) : undefined,
    },
    page: parsePageParam(params.page),
    pageSize: parsePageSizeParam(params.pageSize),
  };
}

export type AccessRequestUrlState = AccessRequestPageSearchParams;

const BASE_PATH = "/platform/beta/access-requests";

export function buildAccessRequestHref(
  current: AccessRequestUrlState,
  updates: Partial<AccessRequestUrlState> & {
    clearStatus?: boolean;
    toggleStatus?: AccessRequestTriageStatus;
  },
): string {
  const next: AccessRequestUrlState = { ...current };

  if (updates.clearStatus) {
    delete next.status;
  }

  if (updates.toggleStatus !== undefined) {
    if (next.status === updates.toggleStatus) {
      delete next.status;
    } else {
      next.status = updates.toggleStatus;
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === "clearStatus" || key === "toggleStatus") {
      continue;
    }
    const paramKey = key as keyof AccessRequestUrlState;
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
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

/** Serialize current filter state for client filter navigation. */
export function accessRequestFiltersToUrlState(
  filters: AccessRequestInboxFilters,
  page: number,
  pageSize: number,
): AccessRequestUrlState {
  return {
    status: filters.status,
    search: filters.search,
    page: page > 1 ? String(page) : undefined,
    pageSize: pageSize !== DEFAULT_PAGE_SIZE ? String(pageSize) : undefined,
  };
}
