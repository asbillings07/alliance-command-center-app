import { Prisma } from "@/app/generated/prisma/client";
import type {
  AccessRequestTriageStatus,
  AccessRequestTriageEventType,
  InvitationConflictType,
} from "@/app/generated/prisma/enums";
import { prisma } from "../prisma";
import { resolveInvitationConflict, type InvitationConflictResolution } from "../invitationConflict";
import { WAVE_MIN, WAVE_MAX } from "../accessRequestTriage";
import {
  boundBetaParticipantsInput,
  buildIlikeContainsPattern,
  clampBetaParticipantsPagination,
} from "./betaParticipants";

/**
 * Read model for the platform beta access-request queue (#177).
 *
 * Unlike feedbackInbox.ts's derivation CTE, this is a plain LEFT JOIN:
 * AccessRequestTriage (PR 1) already denormalizes status, betaWave,
 * currentReason, and both actor snapshots directly onto the projection row,
 * so there is no per-row aggregation to do here. Two queries (paginated rows,
 * status counts) rather than feedbackInbox's single-round-trip UNION ALL —
 * that shape was a #176-specific decision, not a project-wide rule, and this
 * table is small enough that the simpler, more readable form is preferable.
 */

export const ACCESS_REQUEST_INBOX_WAVE_OPTIONS_LIMIT = 100;

const ALL_TRIAGE_STATUSES: AccessRequestTriageStatus[] = [
  "PENDING",
  "INVITED",
  "DECLINED",
  "RESOLVED_EXISTING_ACCESS",
];

export type AccessRequestInboxFilters = {
  /** undefined = all statuses */
  status?: AccessRequestTriageStatus;
  /** Matches name or email (ILIKE, bounded + escaped) */
  search?: string;
};

export type AccessRequestInboxListItem = {
  accessRequestId: string;
  name: string;
  email: string;
  allianceName: string | null;
  message: string | null;
  /** Original, immutable submission time — never a decision timestamp. */
  createdAt: Date;
  /** Defaults to PENDING when no AccessRequestTriage row exists yet (lazy creation, PR 1). */
  status: AccessRequestTriageStatus;
  betaWave: string | null;
  linkedInvitationId: string | null;
  currentReason: string | null;
  /** Needed by every action button for optimistic concurrency (STALE_CONFLICT). */
  stateRevision: number;
  lastEventAt: Date | null;
  lastEventActorEmail: string | null;
  lastEventActorDisplayName: string | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

export type AccessRequestInboxStatusCounts = Record<AccessRequestTriageStatus, number>;

export type AccessRequestInboxListResult = {
  items: AccessRequestInboxListItem[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: AccessRequestInboxStatusCounts;
};

type ListRow = {
  access_request_id: string;
  name: string;
  email: string;
  alliance_name: string | null;
  message: string | null;
  created_at: Date;
  status: AccessRequestTriageStatus;
  beta_wave: string | null;
  linked_invitation_id: string | null;
  current_reason: string | null;
  state_revision: number;
  last_event_at: Date | null;
  last_event_actor_email: string | null;
  last_event_actor_display_name: string | null;
  last_state_change_at: Date | null;
  last_state_change_actor_email: string | null;
  last_state_change_actor_display_name: string | null;
};

function mapListRow(row: ListRow): AccessRequestInboxListItem {
  return {
    accessRequestId: row.access_request_id,
    name: row.name,
    email: row.email,
    allianceName: row.alliance_name,
    message: row.message,
    createdAt: row.created_at,
    status: row.status,
    betaWave: row.beta_wave,
    linkedInvitationId: row.linked_invitation_id,
    currentReason: row.current_reason,
    stateRevision: row.state_revision,
    lastEventAt: row.last_event_at,
    lastEventActorEmail: row.last_event_actor_email,
    lastEventActorDisplayName: row.last_event_actor_display_name,
    lastStateChangeAt: row.last_state_change_at,
    lastStateChangeActorEmail: row.last_state_change_actor_email,
    lastStateChangeActorDisplayName: row.last_state_change_actor_display_name,
  };
}

function buildFilterSql(filters: AccessRequestInboxFilters, searchPattern: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (searchPattern) {
    conditions.push(Prisma.sql`(
      ar.name ILIKE ${searchPattern} ESCAPE '\\'
      OR ar.email ILIKE ${searchPattern} ESCAPE '\\'
    )`);
  }

  if (filters.status) {
    conditions.push(
      Prisma.sql`COALESCE(art.status, 'PENDING'::"AccessRequestTriageStatus") = ${filters.status}::"AccessRequestTriageStatus"`,
    );
  }

  if (conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }

  return Prisma.join(conditions, " AND ");
}

function emptyStatusCounts(): AccessRequestInboxStatusCounts {
  return { PENDING: 0, INVITED: 0, DECLINED: 0, RESOLVED_EXISTING_ACCESS: 0 };
}

/**
 * Paginated, filterable access-request queue with per-status counts (#177).
 */
export async function listAccessRequestsForTriage(
  filters: AccessRequestInboxFilters,
  page: number,
  pageSize: number,
): Promise<AccessRequestInboxListResult> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } = clampBetaParticipantsPagination(
    page,
    pageSize,
  );

  const boundedSearch = boundBetaParticipantsInput(filters.search);
  const searchPattern = buildIlikeContainsPattern(boundedSearch);
  const boundedFilters: AccessRequestInboxFilters = { ...filters, search: boundedSearch };

  const filterSql = buildFilterSql(boundedFilters, searchPattern);

  const [rows, total, countRows] = await Promise.all([
    prisma.$queryRaw<ListRow[]>`
      SELECT
        ar.id AS access_request_id,
        ar.name,
        ar.email,
        ar."allianceName" AS alliance_name,
        ar.message,
        ar."createdAt" AS created_at,
        COALESCE(art.status, 'PENDING'::"AccessRequestTriageStatus") AS status,
        art."betaWave" AS beta_wave,
        art."linkedInvitationId" AS linked_invitation_id,
        art."currentReason" AS current_reason,
        COALESCE(art."stateRevision", 0) AS state_revision,
        art."lastEventAt" AS last_event_at,
        art."lastEventActorEmail" AS last_event_actor_email,
        art."lastEventActorDisplayName" AS last_event_actor_display_name,
        art."lastStateChangeAt" AS last_state_change_at,
        art."lastStateChangeActorEmail" AS last_state_change_actor_email,
        art."lastStateChangeActorDisplayName" AS last_state_change_actor_display_name
      FROM "AccessRequest" ar
      LEFT JOIN "AccessRequestTriage" art ON art."accessRequestId" = ar.id
      WHERE ${filterSql}
      ORDER BY ar."createdAt" DESC, ar.id DESC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "AccessRequest" ar
      LEFT JOIN "AccessRequestTriage" art ON art."accessRequestId" = ar.id
      WHERE ${filterSql}
    `,
    prisma.$queryRaw<Array<{ status: AccessRequestTriageStatus; count: bigint }>>`
      SELECT COALESCE(art.status, 'PENDING'::"AccessRequestTriageStatus") AS status, COUNT(*)::bigint AS count
      FROM "AccessRequest" ar
      LEFT JOIN "AccessRequestTriage" art ON art."accessRequestId" = ar.id
      GROUP BY COALESCE(art.status, 'PENDING'::"AccessRequestTriageStatus")
    `,
  ]);

  const statusCounts = emptyStatusCounts();
  for (const row of countRows) {
    statusCounts[row.status] = Number(row.count);
  }

  return {
    items: rows.map(mapListRow),
    total: Number(total[0]?.total ?? BigInt(0)),
    page: clampedPage,
    pageSize: clampedPageSize,
    statusCounts,
  };
}

export type AccessRequestTriageHistoryItem = {
  id: string;
  eventType: AccessRequestTriageEventType;
  previousStatus: AccessRequestTriageStatus | null;
  nextStatus: AccessRequestTriageStatus | null;
  actorEmail: string;
  actorDisplayName: string | null;
  createdAt: Date;
  noteText: string | null;
  declineReason: string | null;
  resolutionReason: string | null;
  reopenReason: string | null;
  betaWave: string | null;
  blockedReason: string | null;
  blockedConflictType: InvitationConflictType | null;
  conflictUserEmail: string | null;
  conflictUserDisplayName: string | null;
  conflictAllianceName: string | null;
  conflictMembershipCount: number | null;
  linkedInvitationId: string | null;
};

type HistoryRow = {
  id: string;
  event_type: AccessRequestTriageEventType;
  previous_status: AccessRequestTriageStatus | null;
  next_status: AccessRequestTriageStatus | null;
  actor_email: string;
  actor_display_name: string | null;
  created_at: Date;
  note_text: string | null;
  decline_reason: string | null;
  resolution_reason: string | null;
  reopen_reason: string | null;
  beta_wave: string | null;
  blocked_reason: string | null;
  blocked_conflict_type: InvitationConflictType | null;
  conflict_user_email: string | null;
  conflict_user_display_name: string | null;
  conflict_alliance_name: string | null;
  conflict_membership_count: number | null;
  linked_invitation_id: string | null;
};

function mapHistoryRow(row: HistoryRow): AccessRequestTriageHistoryItem {
  return {
    id: row.id,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    actorEmail: row.actor_email,
    actorDisplayName: row.actor_display_name,
    createdAt: row.created_at,
    noteText: row.note_text,
    declineReason: row.decline_reason,
    resolutionReason: row.resolution_reason,
    reopenReason: row.reopen_reason,
    betaWave: row.beta_wave,
    blockedReason: row.blocked_reason,
    blockedConflictType: row.blocked_conflict_type,
    conflictUserEmail: row.conflict_user_email,
    conflictUserDisplayName: row.conflict_user_display_name,
    conflictAllianceName: row.conflict_alliance_name,
    conflictMembershipCount: row.conflict_membership_count,
    linkedInvitationId: row.linked_invitation_id,
  };
}

/**
 * Paginated decision-history event log for one AccessRequest (#177).
 *
 * Ordered NEWEST FIRST (createdAt DESC, id DESC) — deliberately the opposite
 * of feedbackInbox's ASC history. The requirement is literally "the five
 * newest events": calling this with page=1/pageSize=5 must return exactly
 * that without knowing the total count first. The same function also serves
 * "View full history" with a larger page size / real pagination controls.
 */
export async function listAccessRequestTriageHistory(
  accessRequestId: string,
  page = 1,
  pageSize = 5,
): Promise<{
  items: AccessRequestTriageHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } = clampBetaParticipantsPagination(
    page,
    pageSize,
  );

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<HistoryRow[]>`
      SELECT
        arte.id,
        arte."eventType" AS event_type,
        arte."previousStatus" AS previous_status,
        arte."nextStatus" AS next_status,
        arte."actorEmail" AS actor_email,
        arte."actorDisplayName" AS actor_display_name,
        arte."createdAt" AS created_at,
        arte."noteText" AS note_text,
        arte."declineReason" AS decline_reason,
        arte."resolutionReason" AS resolution_reason,
        arte."reopenReason" AS reopen_reason,
        arte."betaWave" AS beta_wave,
        arte."blockedReason" AS blocked_reason,
        arte."blockedConflictType" AS blocked_conflict_type,
        arte."conflictUserEmail" AS conflict_user_email,
        arte."conflictUserDisplayName" AS conflict_user_display_name,
        arte."conflictAllianceName" AS conflict_alliance_name,
        arte."conflictMembershipCount" AS conflict_membership_count,
        arte."linkedInvitationId" AS linked_invitation_id
      FROM "AccessRequestTriageEvent" arte
      WHERE arte."accessRequestId" = ${accessRequestId}
      ORDER BY arte."createdAt" DESC, arte.id DESC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "AccessRequestTriageEvent" arte
      WHERE arte."accessRequestId" = ${accessRequestId}
    `,
  ]);

  return {
    items: rows.map(mapHistoryRow),
    total: Number(countRows[0]?.total ?? BigInt(0)),
    page: clampedPage,
    pageSize: clampedPageSize,
  };
}

export type BetaWaveOption = { id: string; name: string };

/**
 * Bounded, distinct list of existing beta-wave (BetaInvitation.campaign)
 * values, for the required combobox during approve-and-invite (#177,
 * design decision 3). Lives here rather than betaParticipants.ts because
 * it's needed specifically for the access-request conversion UI — keeps
 * this PR a vertical slice rather than a shared-utility grab bag.
 *
 * `campaign` has no DB-level length constraint and predates #177's stricter
 * validation (issueBetaInvitation only ever did a bare `.trim() || null`),
 * so legacy or directly-seeded rows can carry blank, >WAVE_MAX-character, or
 * control-character-containing values. Offering one of those as a combobox
 * choice would let an operator pick a wave that convertAccessRequestToInvitation
 * then rejects (#177 review) — trimmed via the same WAVE_MIN/WAVE_MAX bound
 * conversion enforces, and outright excluded (not sanitized) if it contains
 * control characters, since there is no safe display rendering for those.
 */
export async function listBetaWaveOptions(): Promise<BetaWaveOption[]> {
  const rows = await prisma.$queryRaw<BetaWaveOption[]>`
    SELECT DISTINCT btrim(campaign) AS id, btrim(campaign) AS name
    FROM "BetaInvitation"
    WHERE campaign IS NOT NULL
      AND campaign !~ '[[:cntrl:]]'
      AND length(btrim(campaign)) BETWEEN ${WAVE_MIN} AND ${WAVE_MAX}
    ORDER BY btrim(campaign) ASC
    LIMIT ${ACCESS_REQUEST_INBOX_WAVE_OPTIONS_LIMIT}
  `;
  return rows;
}

/**
 * Cheap PENDING-only count for the Beta page's discovery-card badge (#177
 * review) — avoids running listAccessRequestsForTriage's full paginated
 * rows + total + per-status-count queries (3 round trips) just to read one
 * number on every /platform/beta render.
 */
export async function getAccessRequestPendingCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "AccessRequest" ar
    LEFT JOIN "AccessRequestTriage" art ON art."accessRequestId" = ar.id
    WHERE COALESCE(art.status, 'PENDING'::"AccessRequestTriageStatus") = 'PENDING'::"AccessRequestTriageStatus"
  `;
  return Number(rows[0]?.count ?? BigInt(0));
}

export type AccessRequestConflictCheckResult =
  | { ok: true; resolution: InvitationConflictResolution }
  | { ok: false; error: "NOT_FOUND" };

/**
 * On-demand, scalar conflict pre-check for ONE access request (#177 design
 * decision: no bulk/batched hint in the list — this is only ever called for
 * a single request an operator has opened). Reuses PR 1's exact classifier
 * (`resolveInvitationConflict`) so the UI's "here's what we found" panel and
 * the authoritative re-check inside `convertAccessRequestToInvitation` can
 * never disagree about what a conflict IS — only about whether it's still
 * true by the time of the real commit-time re-check.
 */
export async function checkAccessRequestConflict(
  accessRequestId: string,
): Promise<AccessRequestConflictCheckResult> {
  const request = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: { email: true },
  });
  if (!request) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const resolution = await resolveInvitationConflict(prisma, request.email);
  return { ok: true, resolution };
}

/** Exported for parity tests — all status keys are always present. */
export { ALL_TRIAGE_STATUSES as ALL_ACCESS_REQUEST_TRIAGE_STATUSES };
