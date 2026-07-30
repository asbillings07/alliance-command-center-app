import { Prisma } from "@/app/generated/prisma/client";
import type {
  FeedbackCategory,
  FeedbackTriageStatus,
} from "@/app/generated/prisma/enums";
import { resolveFeedbackSubmitterIdentity } from "../feedback";
import { prisma } from "../prisma";
import {
  boundBetaParticipantsInput,
  buildIlikeContainsPattern,
  clampBetaParticipantsPagination,
} from "./betaParticipants";

/** Version marker for the embedded SQL CTE — bump when derivation logic changes. */
export const FEEDBACK_INBOX_CTE_VERSION = 2;

export const FEEDBACK_INBOX_FILTER_OPTIONS_LIMIT = 100;

export type FeedbackInboxFilters = {
  status?: FeedbackTriageStatus;
  category?: FeedbackCategory;
  allianceId?: string;
  participantId?: string;
  wave?: string;
  needsResponse?: boolean;
  search?: string;
};

export type FeedbackInboxListItem = {
  feedbackId: string;
  category: FeedbackCategory;
  message: string;
  submitterEmail: string;
  submitterDisplayName: string | null;
  allianceId: string | null;
  allianceName: string | null;
  participantId: string | null;
  wave: string | null;
  status: FeedbackTriageStatus;
  needsResponse: boolean;
  hasBeenTriaged: boolean;
  githubIssueUrl: string | null;
  stateRevision: number;
  lastEventAt: Date | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
  createdAt: Date;
};

export type FeedbackInboxStatusCounts = Record<FeedbackTriageStatus, number>;

export type FeedbackInboxSummary = {
  statusCounts: FeedbackInboxStatusCounts;
  needsResponseCount: number;
  totalMatchingOtherFacets: number;
};

export type FeedbackInboxListResult = {
  items: FeedbackInboxListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: FeedbackInboxSummary;
};

export type FeedbackInboxFilterOption = {
  id: string;
  name: string;
};

export type FeedbackInboxFilterOptionsResult = {
  alliances: FeedbackInboxFilterOption[];
  waves: FeedbackInboxFilterOption[];
};

export type FeedbackTriageHistoryItem = {
  id: string;
  actorEmail: string;
  actorDisplayName: string | null;
  createdAt: Date;
  statusChangedTo: FeedbackTriageStatus | null;
  noteText: string | null;
  needsResponseChangedTo: boolean | null;
  githubIssueUrlChanged: boolean;
  githubIssueUrlChangedTo: string | null;
};

const ALL_TRIAGE_STATUSES: FeedbackTriageStatus[] = [
  "NEW",
  "TRIAGED",
  "PLANNED",
  "RESOLVED",
  "DISMISSED",
];

/**
 * Shared SQL CTE fragment. Joins feedback with triage projection (LEFT, with
 * coalesced defaults), optional alliance, and optional beta participant wave.
 */
export function feedbackInboxDerivationCte(): Prisma.Sql {
  return Prisma.sql`
  latest_invitation AS (
    SELECT DISTINCT ON (bi."participantId")
      bi."participantId",
      bi.campaign
    FROM "BetaInvitation" bi
    ORDER BY
      bi."participantId",
      bi."issuedAt" DESC,
      bi."createdAt" DESC,
      bi."id" DESC
  ),
  derived AS (
    SELECT
      f.id AS feedback_id,
      f.category,
      f.message,
      f."submitterEmail" AS submitter_email,
      f."submitterDisplayName" AS submitter_display_name,
      f."userId" AS user_id,
      u.email AS user_email,
      u."displayName" AS user_display_name,
      f."allianceId" AS alliance_id,
      a.name AS alliance_name,
      bp.id AS participant_id,
      li.campaign AS wave,
      COALESCE(ft.status, 'NEW'::"FeedbackTriageStatus") AS status,
      COALESCE(ft."needsResponse", TRUE) AS needs_response,
      COALESCE(ft."stateRevision", 0) AS state_revision,
      COALESCE(ft."lastEventAt", f."createdAt") AS last_event_at,
      ft."lastStateChangeAt" AS last_state_change_at,
      ft."lastStateChangeActorEmail" AS last_state_change_actor_email,
      ft."lastStateChangeActorDisplayName" AS last_state_change_actor_display_name,
      ft."githubIssueUrl" AS github_issue_url,
      f."createdAt" AS created_at,
      EXISTS (
        SELECT 1
        FROM "FeedbackTriageEvent" fte
        WHERE fte."feedbackId" = f.id
      ) AS has_been_triaged
    FROM "Feedback" f
    LEFT JOIN "FeedbackTriage" ft ON ft."feedbackId" = f.id
    LEFT JOIN "User" u ON u.id = f."userId"
    LEFT JOIN "Alliance" a ON a.id = f."allianceId"
    LEFT JOIN "BetaParticipant" bp ON bp."userId" = f."userId"
    LEFT JOIN latest_invitation li ON li."participantId" = bp.id
  )
`;
}

type DerivedRow = {
  feedback_id: string;
  category: FeedbackCategory;
  message: string;
  submitter_email: string | null;
  submitter_display_name: string | null;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  alliance_id: string | null;
  alliance_name: string | null;
  participant_id: string | null;
  wave: string | null;
  status: FeedbackTriageStatus;
  needs_response: boolean;
  state_revision: number;
  last_event_at: Date | null;
  last_state_change_at: Date | null;
  last_state_change_actor_email: string | null;
  last_state_change_actor_display_name: string | null;
  github_issue_url: string | null;
  created_at: Date;
  has_been_triaged: boolean;
};

function buildFilterSql(
  filters: FeedbackInboxFilters,
  searchPattern: string,
  waveValue: string,
  options: { excludeStatus?: boolean; excludeNeedsResponse?: boolean } = {},
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (searchPattern) {
    conditions.push(Prisma.sql`(
      COALESCE(d.submitter_email, d.user_email, '') ILIKE ${searchPattern} ESCAPE '\\'
      OR COALESCE(d.submitter_display_name, d.user_display_name, '') ILIKE ${searchPattern} ESCAPE '\\'
      OR d.message ILIKE ${searchPattern} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM "BetaInvitation" bi_search
        JOIN "BetaParticipant" bp_search ON bp_search.id = bi_search."participantId"
        WHERE bp_search."userId" = d.user_id
          AND d.user_id IS NOT NULL
          AND bi_search.email ILIKE ${searchPattern} ESCAPE '\\'
      )
    )`);
  }

  if (waveValue) {
    conditions.push(Prisma.sql`d.wave = ${waveValue}`);
  }

  if (filters.category) {
    conditions.push(
      Prisma.sql`d.category = ${filters.category}::"FeedbackCategory"`,
    );
  }

  if (filters.allianceId) {
    conditions.push(Prisma.sql`d.alliance_id = ${filters.allianceId}`);
  }

  if (filters.participantId) {
    conditions.push(Prisma.sql`d.participant_id = ${filters.participantId}`);
  }

  if (!options.excludeStatus && filters.status) {
    conditions.push(
      Prisma.sql`d.status = ${filters.status}::"FeedbackTriageStatus"`,
    );
  }

  if (!options.excludeNeedsResponse && filters.needsResponse !== undefined) {
    conditions.push(Prisma.sql`d.needs_response = ${filters.needsResponse}`);
  }

  if (conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }

  return Prisma.join(conditions, " AND ");
}

function mapDerivedRow(row: DerivedRow): FeedbackInboxListItem {
  const identity = resolveFeedbackSubmitterIdentity({
    submitterEmail: row.submitter_email,
    submitterDisplayName: row.submitter_display_name,
    user:
      row.user_email != null
        ? {
            email: row.user_email,
            displayName: row.user_display_name,
          }
        : null,
  });

  return {
    feedbackId: row.feedback_id,
    category: row.category,
    message: row.message,
    submitterEmail: identity.email,
    submitterDisplayName: identity.displayName,
    allianceId: row.alliance_id,
    allianceName: row.alliance_name,
    participantId: row.participant_id,
    wave: row.wave,
    status: row.status,
    needsResponse: row.needs_response,
    hasBeenTriaged: row.has_been_triaged,
    githubIssueUrl: row.github_issue_url,
    stateRevision: row.state_revision,
    lastEventAt: row.last_event_at,
    lastStateChangeAt: row.last_state_change_at,
    lastStateChangeActorEmail: row.last_state_change_actor_email,
    lastStateChangeActorDisplayName: row.last_state_change_actor_display_name,
    createdAt: row.created_at,
  };
}

function emptyStatusCounts(): FeedbackInboxStatusCounts {
  return {
    NEW: 0,
    TRIAGED: 0,
    PLANNED: 0,
    RESOLVED: 0,
    DISMISSED: 0,
  };
}

function mapSummaryFromStats(row: {
  status_new: bigint;
  status_triaged: bigint;
  status_planned: bigint;
  status_resolved: bigint;
  status_dismissed: bigint;
  needs_response_count: bigint;
  total_matching_other_facets: bigint;
}): FeedbackInboxSummary {
  return {
    statusCounts: {
      NEW: Number(row.status_new),
      TRIAGED: Number(row.status_triaged),
      PLANNED: Number(row.status_planned),
      RESOLVED: Number(row.status_resolved),
      DISMISSED: Number(row.status_dismissed),
    },
    needsResponseCount: Number(row.needs_response_count),
    totalMatchingOtherFacets: Number(row.total_matching_other_facets),
  };
}

/**
 * Paginated feedback inbox list with filters and facet summary aggregates.
 * Rows, total, and summary come from one SQL round-trip (#176 decision 10).
 */
export async function listFeedbackForTriage(
  filters: FeedbackInboxFilters,
  page: number,
  pageSize: number,
): Promise<FeedbackInboxListResult> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } =
    clampBetaParticipantsPagination(page, pageSize);

  const boundedFilters: FeedbackInboxFilters = {
    ...filters,
    search: boundBetaParticipantsInput(filters.search),
    wave: boundBetaParticipantsInput(filters.wave),
    allianceId: filters.allianceId
      ? boundBetaParticipantsInput(filters.allianceId)
      : undefined,
    participantId: filters.participantId
      ? boundBetaParticipantsInput(filters.participantId)
      : undefined,
  };

  const searchPattern = buildIlikeContainsPattern(boundedFilters.search ?? "");
  const waveValue = boundedFilters.wave ?? "";

  const fullFilterSql = buildFilterSql(
    boundedFilters,
    searchPattern,
    waveValue,
  );
  const exceptStatusFilterSql = buildFilterSql(
    boundedFilters,
    searchPattern,
    waveValue,
    { excludeStatus: true },
  );
  const exceptNeedsResponseFilterSql = buildFilterSql(
    boundedFilters,
    searchPattern,
    waveValue,
    { excludeNeedsResponse: true },
  );
  const exceptStatusAndNeedsResponseFilterSql = buildFilterSql(
    boundedFilters,
    searchPattern,
    waveValue,
    { excludeStatus: true, excludeNeedsResponse: true },
  );

  const cte = feedbackInboxDerivationCte();

  type UnifiedListRow = DerivedRow & {
    total: bigint;
    status_new: bigint;
    status_triaged: bigint;
    status_planned: bigint;
    status_resolved: bigint;
    status_dismissed: bigint;
    needs_response_count: bigint;
    total_matching_other_facets: bigint;
  };

  const unifiedRows = await prisma.$queryRaw<UnifiedListRow[]>`
    WITH ${cte},
    stats AS (
      SELECT
        COUNT(*) FILTER (WHERE ${fullFilterSql})::bigint AS total,
        COUNT(*) FILTER (
          WHERE ${exceptStatusFilterSql}
            AND d.status = 'NEW'::"FeedbackTriageStatus"
        )::bigint AS status_new,
        COUNT(*) FILTER (
          WHERE ${exceptStatusFilterSql}
            AND d.status = 'TRIAGED'::"FeedbackTriageStatus"
        )::bigint AS status_triaged,
        COUNT(*) FILTER (
          WHERE ${exceptStatusFilterSql}
            AND d.status = 'PLANNED'::"FeedbackTriageStatus"
        )::bigint AS status_planned,
        COUNT(*) FILTER (
          WHERE ${exceptStatusFilterSql}
            AND d.status = 'RESOLVED'::"FeedbackTriageStatus"
        )::bigint AS status_resolved,
        COUNT(*) FILTER (
          WHERE ${exceptStatusFilterSql}
            AND d.status = 'DISMISSED'::"FeedbackTriageStatus"
        )::bigint AS status_dismissed,
        COUNT(*) FILTER (
          WHERE ${exceptNeedsResponseFilterSql}
            AND d.needs_response = TRUE
        )::bigint AS needs_response_count,
        COUNT(*) FILTER (WHERE ${exceptStatusAndNeedsResponseFilterSql})::bigint AS total_matching_other_facets
      FROM derived d
    ),
    page AS (
      SELECT d.*
      FROM derived d
      WHERE ${fullFilterSql}
      ORDER BY
        d.created_at DESC,
        d.feedback_id DESC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    ),
    combined AS (
      SELECT
        0 AS row_kind,
        p.feedback_id,
        p.category,
        p.message,
        p.submitter_email,
        p.submitter_display_name,
        p.user_id,
        p.user_email,
        p.user_display_name,
        p.alliance_id,
        p.alliance_name,
        p.participant_id,
        p.wave,
        p.status,
        p.needs_response,
        p.state_revision,
        p.last_event_at,
        p.last_state_change_at,
        p.last_state_change_actor_email,
        p.last_state_change_actor_display_name,
        p.github_issue_url,
        p.created_at,
        p.has_been_triaged,
        s.total,
        s.status_new,
        s.status_triaged,
        s.status_planned,
        s.status_resolved,
        s.status_dismissed,
        s.needs_response_count,
        s.total_matching_other_facets
      FROM stats s
      INNER JOIN page p ON TRUE
      UNION ALL
      SELECT
        1 AS row_kind,
        NULL AS feedback_id,
        NULL AS category,
        NULL AS message,
        NULL AS submitter_email,
        NULL AS submitter_display_name,
        NULL AS user_id,
        NULL AS user_email,
        NULL AS user_display_name,
        NULL AS alliance_id,
        NULL AS alliance_name,
        NULL AS participant_id,
        NULL AS wave,
        NULL AS status,
        NULL AS needs_response,
        NULL AS state_revision,
        NULL AS last_event_at,
        NULL AS last_state_change_at,
        NULL AS last_state_change_actor_email,
        NULL AS last_state_change_actor_display_name,
        NULL AS github_issue_url,
        NULL AS created_at,
        NULL AS has_been_triaged,
        s.total,
        s.status_new,
        s.status_triaged,
        s.status_planned,
        s.status_resolved,
        s.status_dismissed,
        s.needs_response_count,
        s.total_matching_other_facets
      FROM stats s
      WHERE NOT EXISTS (SELECT 1 FROM page)
    )
    SELECT
      c.feedback_id,
      c.category,
      c.message,
      c.submitter_email,
      c.submitter_display_name,
      c.user_id,
      c.user_email,
      c.user_display_name,
      c.alliance_id,
      c.alliance_name,
      c.participant_id,
      c.wave,
      c.status,
      c.needs_response,
      c.state_revision,
      c.last_event_at,
      c.last_state_change_at,
      c.last_state_change_actor_email,
      c.last_state_change_actor_display_name,
      c.github_issue_url,
      c.created_at,
      c.has_been_triaged,
      c.total,
      c.status_new,
      c.status_triaged,
      c.status_planned,
      c.status_resolved,
      c.status_dismissed,
      c.needs_response_count,
      c.total_matching_other_facets
    FROM combined c
    ORDER BY
      c.row_kind ASC,
      c.created_at DESC NULLS LAST,
      c.feedback_id DESC NULLS LAST
  `;

  const summarySource = unifiedRows[0];
  const total = Number(summarySource?.total ?? BigInt(0));
  const itemRows = unifiedRows.filter(
    (row): row is UnifiedListRow => row.feedback_id !== null,
  );

  return {
    items: itemRows.map(mapDerivedRow),
    total,
    page: clampedPage,
    pageSize: clampedPageSize,
    summary: summarySource
      ? mapSummaryFromStats(summarySource)
      : {
          statusCounts: emptyStatusCounts(),
          needsResponseCount: 0,
          totalMatchingOtherFacets: 0,
        },
  };
}

/**
 * Bounded dropdown option lists for alliance and wave filters (#176 decision 12).
 */
export async function listFeedbackFilterOptions(): Promise<FeedbackInboxFilterOptionsResult> {
  const limit = FEEDBACK_INBOX_FILTER_OPTIONS_LIMIT;

  const [alliances, waves] = await Promise.all([
    prisma.$queryRaw<FeedbackInboxFilterOption[]>`
      SELECT DISTINCT
        a.id,
        a.name
      FROM "Feedback" f
      JOIN "Alliance" a ON a.id = f."allianceId"
      WHERE f."allianceId" IS NOT NULL
      ORDER BY a.name ASC, a.id ASC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<FeedbackInboxFilterOption[]>`
      WITH latest_invitation AS (
        SELECT DISTINCT ON (bi."participantId")
          bi."participantId",
          bi.campaign
        FROM "BetaInvitation" bi
        ORDER BY
          bi."participantId",
          bi."issuedAt" DESC,
          bi."createdAt" DESC,
          bi."id" DESC
      )
      SELECT DISTINCT
        li.campaign AS id,
        li.campaign AS name
      FROM "Feedback" f
      JOIN "BetaParticipant" bp ON bp."userId" = f."userId"
      JOIN latest_invitation li ON li."participantId" = bp.id
      WHERE li.campaign IS NOT NULL
      ORDER BY li.campaign ASC
      LIMIT ${limit}
    `,
  ]);

  return { alliances, waves };
}

type HistoryRow = {
  id: string;
  actor_email: string;
  actor_display_name: string | null;
  created_at: Date;
  status_changed_to: FeedbackTriageStatus | null;
  note_text: string | null;
  needs_response_changed_to: boolean | null;
  github_issue_url_changed: boolean;
  github_issue_url_changed_to: string | null;
};

function mapHistoryRow(row: HistoryRow): FeedbackTriageHistoryItem {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    actorDisplayName: row.actor_display_name,
    createdAt: row.created_at,
    statusChangedTo: row.status_changed_to,
    noteText: row.note_text,
    needsResponseChangedTo: row.needs_response_changed_to,
    githubIssueUrlChanged: row.github_issue_url_changed,
    githubIssueUrlChangedTo: row.github_issue_url_changed_to,
  };
}

/**
 * Paginated triage event history for one feedback item (#176 decision 8).
 */
export async function listFeedbackTriageHistory(
  feedbackId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: FeedbackTriageHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } =
    clampBetaParticipantsPagination(page, pageSize);

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<HistoryRow[]>`
      SELECT
        fte.id,
        fte."actorEmail" AS actor_email,
        fte."actorDisplayName" AS actor_display_name,
        fte."createdAt" AS created_at,
        fte."statusChangedTo" AS status_changed_to,
        fte."noteText" AS note_text,
        fte."needsResponseChangedTo" AS needs_response_changed_to,
        fte."githubIssueUrlChanged" AS github_issue_url_changed,
        fte."githubIssueUrlChangedTo" AS github_issue_url_changed_to
      FROM "FeedbackTriageEvent" fte
      WHERE fte."feedbackId" = ${feedbackId}
      ORDER BY
        fte."createdAt" ASC,
        fte.id ASC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "FeedbackTriageEvent" fte
      WHERE fte."feedbackId" = ${feedbackId}
    `,
  ]);

  return {
    items: rows.map(mapHistoryRow),
    total: Number(countRows[0]?.total ?? BigInt(0)),
    page: clampedPage,
    pageSize: clampedPageSize,
  };
}

/** Exported for unit tests asserting facet filter SQL composition. */
export function buildFeedbackInboxFilterSqlForTest(
  filters: FeedbackInboxFilters,
  searchPattern: string,
  waveValue: string,
  options: { excludeStatus?: boolean; excludeNeedsResponse?: boolean } = {},
): string {
  const sql = buildFilterSql(filters, searchPattern, waveValue, options);
  if (!sql || typeof sql !== "object" || !("strings" in sql)) {
    return String(sql);
  }
  const fragment = sql as { strings: string[]; values: unknown[] };
  let result = fragment.strings[0] ?? "";
  for (let i = 0; i < fragment.values.length; i++) {
    result += String(fragment.values[i]);
    result += fragment.strings[i + 1] ?? "";
  }
  return result;
}

/** Exported for parity tests — all status keys are always present. */
export { ALL_TRIAGE_STATUSES };
