import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { getAppOrigin } from "../appUrl";

/** Version marker for the embedded SQL CTE — bump when derivation logic changes. */
export const BETA_PARTICIPANTS_CTE_VERSION = 2;

export const BETA_PARTICIPANTS_PAGE_SIZE_MIN = 1;
export const BETA_PARTICIPANTS_PAGE_SIZE_MAX = 50;
export const BETA_PARTICIPANTS_MAX_OFFSET = 10_000;
export const BETA_PARTICIPANTS_INPUT_MAX_LENGTH = 200;
export const BETA_PARTICIPANTS_ATTENTION_STALE_DAYS = 7;
/** Max participants returned for platform Action Required beta items. */
export const BETA_PARTICIPANTS_ATTENTION_LIST_LIMIT = 50;

export type BetaJourneyStage =
  | "invited"
  | "accepted"
  | "alliance_created"
  | "roster_imported"
  | "first_dataset_recorded"
  | "setup_complete";

export type BetaAttentionReason =
  | "invitation_expired"
  | "invitation_pending_stale"
  | "accepted_no_alliance"
  | "setup_stalled";

export type BetaInvitationAttemptStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked";

/** Resolved operator identity for attempt-level attribution (#174). */
export type BetaAttemptOperator = {
  userId: string | null;
  displayName: string | null;
  email: string | null;
};

export type BetaInvitationAttemptRecord = {
  id: string;
  email: string;
  code: string;
  status: BetaInvitationAttemptStatus;
  campaign: string | null;
  notes: string | null;
  issuedAt: Date;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  issuedBy: BetaAttemptOperator | null;
  revokedBy: BetaAttemptOperator | null;
  acceptedBy: BetaAttemptOperator | null;
};

export type BetaParticipantFilters = {
  search?: string;
  wave?: string;
  journeyStage?: BetaJourneyStage;
  attentionReason?: BetaAttentionReason;
};

export type BetaParticipantListItem = {
  participantId: string;
  identityAmbiguous: boolean;
  displayName: string | null;
  currentEmail: string | null;
  wave: string | null;
  journeyStage: BetaJourneyStage;
  attentionReason: BetaAttentionReason | null;
  attentionSince: Date | null;
  allianceAmbiguous: boolean;
  allianceId: string | null;
  allianceName: string | null;
  priorAttemptCount: number;
  latestAttempt: BetaInvitationAttemptRecord & {
    token: string;
    inviteUrl: string;
  };
};

/** Minimal projection for platform Action Required beta items — no invitation secrets. */
export type BetaParticipantAttentionRow = {
  participantId: string;
  identityAmbiguous: boolean;
  displayName: string | null;
  currentEmail: string | null;
  latestAttemptEmail: string;
  attentionReason: BetaAttentionReason;
  attentionSince: Date | null;
  allianceAmbiguous: boolean;
  allianceId: string | null;
  allianceName: string | null;
};

export type BetaParticipantSummary = {
  totalParticipants: number;
  totalInvitationAttempts: number;
  acceptedParticipants: number;
  needsAttention: number;
  distinctAlliancesCreated: number;
  distinctAlliancesSetupComplete: number;
};

export type BetaParticipantListResult = {
  items: BetaParticipantListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: BetaParticipantSummary;
};

export type BetaParticipantPriorAttempt = BetaInvitationAttemptRecord;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Clamp pagination inputs: pageSize 1–50, page ≥ 1 and capped so offset ≤ 10_000.
 */
export function clampBetaParticipantsPagination(
  page: number,
  pageSize: number,
): { page: number; pageSize: number; offset: number } {
  const normalizedPageSize = Number.isFinite(pageSize)
    ? Math.floor(pageSize)
    : BETA_PARTICIPANTS_PAGE_SIZE_MAX;
  const clampedPageSize = Math.min(
    BETA_PARTICIPANTS_PAGE_SIZE_MAX,
    Math.max(BETA_PARTICIPANTS_PAGE_SIZE_MIN, normalizedPageSize),
  );

  const normalizedPage = Number.isFinite(page) ? Math.floor(page) : 1;
  const maxPage = Math.max(
    1,
    Math.floor(BETA_PARTICIPANTS_MAX_OFFSET / clampedPageSize),
  );
  const clampedPage = Math.min(maxPage, Math.max(1, normalizedPage));

  return {
    page: clampedPage,
    pageSize: clampedPageSize,
    offset: (clampedPage - 1) * clampedPageSize,
  };
}

/** Bound filter string inputs before binding into SQL. */
export function boundBetaParticipantsInput(
  raw: string | undefined | null,
): string {
  if (!raw) {
    return "";
  }
  return raw.slice(0, BETA_PARTICIPANTS_INPUT_MAX_LENGTH);
}

/** Escape `%`, `_`, and `\` for use with `ILIKE ... ESCAPE '\'`. */
export function escapeIlikePattern(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export function buildIlikeContainsPattern(raw: string): string {
  const bounded = boundBetaParticipantsInput(raw);
  if (!bounded) {
    return "";
  }
  return `%${escapeIlikePattern(bounded)}%`;
}

export function deriveLatestAttemptStatus(
  row: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now: Date,
): BetaInvitationAttemptStatus {
  if (row.acceptedAt) {
    return "accepted";
  }
  if (row.revokedAt) {
    return "revoked";
  }
  if (row.expiresAt < now) {
    return "expired";
  }
  return "pending";
}

export function daysSince(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / MS_PER_DAY;
}

export function deriveJourneyStage(input: {
  allianceAmbiguous: boolean;
  hasAccepted: boolean;
  allianceId: string | null;
  activeMemberCount: number;
  hasTargetPeriodData: boolean;
  isComplete: boolean;
}): BetaJourneyStage {
  if (input.allianceAmbiguous && input.hasAccepted) {
    return "accepted";
  }
  if (input.isComplete) {
    return "setup_complete";
  }
  if (input.hasTargetPeriodData) {
    return "first_dataset_recorded";
  }
  if (input.activeMemberCount > 0) {
    return "roster_imported";
  }
  if (input.allianceId) {
    return "alliance_created";
  }
  if (input.hasAccepted) {
    return "accepted";
  }
  return "invited";
}

export function deriveParticipantAttention(input: {
  now: Date;
  latestStatus: BetaInvitationAttemptStatus;
  latestIssuedAt: Date;
  latestExpiresAt: Date;
  hasAccepted: boolean;
  firstAcceptedAt: Date | null;
  allianceId: string | null;
  isComplete: boolean;
  lastSetupActivityAt: Date | null;
}): { reason: BetaAttentionReason | null; since: Date | null } {
  if (input.isComplete) {
    return { reason: null, since: null };
  }

  if (input.latestStatus === "revoked" && !input.hasAccepted) {
    return { reason: null, since: null };
  }

  if (
    input.allianceId &&
    input.lastSetupActivityAt &&
    daysSince(input.now, input.lastSetupActivityAt) >=
      BETA_PARTICIPANTS_ATTENTION_STALE_DAYS
  ) {
    return { reason: "setup_stalled", since: input.lastSetupActivityAt };
  }

  if (
    input.hasAccepted &&
    !input.allianceId &&
    input.firstAcceptedAt &&
    daysSince(input.now, input.firstAcceptedAt) >=
      BETA_PARTICIPANTS_ATTENTION_STALE_DAYS
  ) {
    return { reason: "accepted_no_alliance", since: input.firstAcceptedAt };
  }

  if (input.latestStatus === "expired" && !input.hasAccepted) {
    return { reason: "invitation_expired", since: input.latestExpiresAt };
  }

  if (
    input.latestStatus === "pending" &&
    !input.hasAccepted &&
    daysSince(input.now, input.latestIssuedAt) >=
      BETA_PARTICIPANTS_ATTENTION_STALE_DAYS
  ) {
    return { reason: "invitation_pending_stale", since: input.latestIssuedAt };
  }

  return { reason: null, since: null };
}

/**
 * Shared SQL CTE fragment (not a persisted DB view). Computes per-participant
 * alliance resolution, setup completion against the resolveTargetPeriod target
 * period, journey stage, and attention fields. Parameterized by bound $now.
 */
export function betaParticipantsDerivationCte(now: Date): Prisma.Sql {
  const staleCutoff = new Date(
    now.getTime() - BETA_PARTICIPANTS_ATTENTION_STALE_DAYS * MS_PER_DAY,
  );

  return Prisma.sql`
  latest_attempt AS (
    SELECT DISTINCT ON (bi."participantId")
      bi.id,
      bi."participantId",
      bi.email,
      bi."issuedAt",
      bi."createdAt",
      bi."expiresAt",
      bi."acceptedAt",
      bi."revokedAt",
      bi.campaign
    FROM "BetaInvitation" bi
    ORDER BY
      bi."participantId",
      bi."issuedAt" DESC,
      bi."createdAt" DESC,
      bi."id" DESC
  ),
  attempt_counts AS (
    SELECT
      bi."participantId",
      COUNT(*)::int AS attempt_count
    FROM "BetaInvitation" bi
    GROUP BY bi."participantId"
  ),
  participant_accepted AS (
    SELECT
      bi."participantId",
      MIN(bi."acceptedAt") AS first_accepted_at,
      BOOL_OR(bi."acceptedAt" IS NOT NULL) AS has_accepted_invitation
    FROM "BetaInvitation" bi
    GROUP BY bi."participantId"
  ),
  accepted_alliance AS (
    SELECT DISTINCT ON (bi."participantId")
      bi."participantId",
      bi."allianceId"
    FROM "BetaInvitation" bi
    WHERE bi."acceptedAt" IS NOT NULL
      AND bi."allianceId" IS NOT NULL
    ORDER BY
      bi."participantId",
      bi."acceptedAt" DESC,
      bi."issuedAt" DESC,
      bi."id" DESC
  ),
  owner_memberships AS (
    SELECT
      bp.id AS participant_id,
      ARRAY_AGG(am."allianceId" ORDER BY am."createdAt" ASC, am.id ASC) AS owner_alliance_ids
    FROM "BetaParticipant" bp
    JOIN "User" u ON u.id = bp."userId"
    JOIN "AllianceMembership" am ON am."userId" = u.id AND am.role = 'OWNER'
    GROUP BY bp.id
  ),
  resolved_alliance AS (
    SELECT
      bp.id AS participant_id,
      CASE
        WHEN aa."allianceId" IS NOT NULL THEN aa."allianceId"
        WHEN om.owner_alliance_ids IS NULL
          OR CARDINALITY(om.owner_alliance_ids) = 0 THEN NULL
        WHEN CARDINALITY(om.owner_alliance_ids) = 1 THEN om.owner_alliance_ids[1]
        ELSE NULL
      END AS alliance_id,
      CASE
        WHEN aa."allianceId" IS NOT NULL THEN FALSE
        WHEN om.owner_alliance_ids IS NOT NULL
          AND CARDINALITY(om.owner_alliance_ids) > 1 THEN TRUE
        ELSE FALSE
      END AS alliance_ambiguous
    FROM "BetaParticipant" bp
    LEFT JOIN accepted_alliance aa ON aa."participantId" = bp.id
    LEFT JOIN owner_memberships om ON om.participant_id = bp.id
  ),
  target_period AS (
    SELECT DISTINCT ON (mp."allianceId")
      mp."allianceId",
      mp.id AS period_id
    FROM "MetricPeriod" mp
    WHERE mp.active = TRUE
    ORDER BY
      mp."allianceId",
      mp."startsAt" DESC NULLS LAST,
      mp."createdAt" DESC,
      mp.id DESC
  ),
  alliance_setup AS (
    SELECT
      ra.participant_id,
      ra.alliance_id,
      ra.alliance_ambiguous,
      tp.period_id IS NOT NULL AS has_target_period,
      COALESCE((
        SELECT COUNT(*)::int
        FROM "AllianceMember" am
        WHERE am."allianceId" = ra.alliance_id
          AND am."archivedAt" IS NULL
      ), 0) AS active_member_count,
      EXISTS (
        SELECT 1
        FROM "MetricPeriodMetric" mpm
        JOIN "Metric" m ON m.id = mpm."metricId"
        WHERE tp.period_id IS NOT NULL
          AND mpm."periodId" = tp.period_id
          AND mpm.active = TRUE
          AND m.active = TRUE
      ) AS has_attached_metrics,
      EXISTS (
        SELECT 1
        FROM "MemberMetricEntry" mme
        JOIN "MetricPeriodMetric" mpm
          ON mpm."periodId" = mme."periodId"
         AND mpm."metricId" = mme."metricId"
        JOIN "Metric" m ON m.id = mme."metricId"
        WHERE tp.period_id IS NOT NULL
          AND mme."periodId" = tp.period_id
          AND mpm.active = TRUE
          AND m.active = TRUE
          AND mme."allianceMemberId" IN (
            SELECT am.id
            FROM "AllianceMember" am
            WHERE am."allianceId" = ra.alliance_id
          )
      ) AS has_target_period_data,
      (
        tp.period_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "MetricPeriodMetric" mpm
          JOIN "Metric" m ON m.id = mpm."metricId"
          WHERE mpm."periodId" = tp.period_id
            AND mpm.active = TRUE
            AND m.active = TRUE
        )
        AND EXISTS (
          SELECT 1
          FROM "AllianceMember" am
          WHERE am."allianceId" = ra.alliance_id
            AND am."archivedAt" IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM "MemberMetricEntry" mme
          JOIN "MetricPeriodMetric" mpm
            ON mpm."periodId" = mme."periodId"
           AND mpm."metricId" = mme."metricId"
          JOIN "Metric" m ON m.id = mme."metricId"
          WHERE mme."periodId" = tp.period_id
            AND mpm.active = TRUE
            AND m.active = TRUE
            AND mme."allianceMemberId" IN (
              SELECT am.id
              FROM "AllianceMember" am
              WHERE am."allianceId" = ra.alliance_id
            )
        )
      ) AS is_complete,
      a."setupActivityAt" AS last_setup_activity_at
    FROM resolved_alliance ra
    LEFT JOIN target_period tp ON tp."allianceId" = ra.alliance_id
    LEFT JOIN "Alliance" a ON a.id = ra.alliance_id
  ),
  derived AS (
    SELECT
      bp.id AS participant_id,
      bp."identityAmbiguous" AS identity_ambiguous,
      bp."userId" AS user_id,
      u."displayName" AS display_name,
      u.email AS current_email,
      la.id AS latest_attempt_id,
      la.email AS latest_email,
      la.campaign AS latest_campaign,
      la."issuedAt" AS latest_issued_at,
      la."createdAt" AS latest_created_at,
      la."expiresAt" AS latest_expires_at,
      la."acceptedAt" AS latest_accepted_at,
      la."revokedAt" AS latest_revoked_at,
      COALESCE(ac.attempt_count, 1)::int AS attempt_count,
      GREATEST(COALESCE(ac.attempt_count, 1) - 1, 0) AS prior_attempt_count,
      als.alliance_id,
      als.alliance_ambiguous,
      al.name AS alliance_name,
      als.active_member_count,
      als.has_target_period_data,
      als.is_complete AS is_complete,
      als.last_setup_activity_at,
      (
        COALESCE(pa.has_accepted_invitation, FALSE)
        OR bp."userId" IS NOT NULL
      ) AS has_accepted,
      pa.first_accepted_at,
      CASE
        WHEN la."acceptedAt" IS NOT NULL THEN 'accepted'
        WHEN la."revokedAt" IS NOT NULL THEN 'revoked'
        WHEN la."expiresAt" < ${now} THEN 'expired'
        ELSE 'pending'
      END AS latest_status,
      CASE
        WHEN als.alliance_ambiguous
          AND (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN 'accepted'
        WHEN als.is_complete THEN 'setup_complete'
        WHEN als.has_target_period_data THEN 'first_dataset_recorded'
        WHEN als.active_member_count > 0 THEN 'roster_imported'
        WHEN als.alliance_id IS NOT NULL THEN 'alliance_created'
        WHEN COALESCE(pa.has_accepted_invitation, FALSE)
          OR bp."userId" IS NOT NULL THEN 'accepted'
        ELSE 'invited'
      END AS journey_stage,
      CASE
        WHEN als.is_complete THEN NULL
        WHEN la."revokedAt" IS NOT NULL
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN NULL
        WHEN als.alliance_id IS NOT NULL
          AND als.last_setup_activity_at IS NOT NULL
          AND als.last_setup_activity_at <= ${staleCutoff}
          THEN 'setup_stalled'
        WHEN (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          )
          AND als.alliance_id IS NULL
          AND pa.first_accepted_at IS NOT NULL
          AND pa.first_accepted_at <= ${staleCutoff}
          THEN 'accepted_no_alliance'
        WHEN la."acceptedAt" IS NULL
          AND la."revokedAt" IS NULL
          AND la."expiresAt" < ${now}
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN 'invitation_expired'
        WHEN la."acceptedAt" IS NULL
          AND la."revokedAt" IS NULL
          AND la."expiresAt" >= ${now}
          AND la."issuedAt" <= ${staleCutoff}
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN 'invitation_pending_stale'
        ELSE NULL
      END AS attention_reason,
      CASE
        WHEN als.is_complete THEN NULL
        WHEN la."revokedAt" IS NOT NULL
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN NULL
        WHEN als.alliance_id IS NOT NULL
          AND als.last_setup_activity_at IS NOT NULL
          AND als.last_setup_activity_at <= ${staleCutoff}
          THEN als.last_setup_activity_at
        WHEN (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          )
          AND als.alliance_id IS NULL
          AND pa.first_accepted_at IS NOT NULL
          AND pa.first_accepted_at <= ${staleCutoff}
          THEN pa.first_accepted_at
        WHEN la."acceptedAt" IS NULL
          AND la."revokedAt" IS NULL
          AND la."expiresAt" < ${now}
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN la."expiresAt"
        WHEN la."acceptedAt" IS NULL
          AND la."revokedAt" IS NULL
          AND la."expiresAt" >= ${now}
          AND la."issuedAt" <= ${staleCutoff}
          AND NOT (
            COALESCE(pa.has_accepted_invitation, FALSE)
            OR bp."userId" IS NOT NULL
          ) THEN la."issuedAt"
        ELSE NULL
      END AS attention_since
    FROM "BetaParticipant" bp
    JOIN latest_attempt la ON la."participantId" = bp.id
    LEFT JOIN attempt_counts ac ON ac."participantId" = bp.id
    LEFT JOIN participant_accepted pa ON pa."participantId" = bp.id
    LEFT JOIN "User" u ON u.id = bp."userId"
    JOIN alliance_setup als ON als.participant_id = bp.id
    LEFT JOIN "Alliance" al ON al.id = als.alliance_id
  )
`;
}

type DerivedRow = {
  participant_id: string;
  identity_ambiguous: boolean;
  display_name: string | null;
  current_email: string | null;
  latest_attempt_id: string;
  latest_email: string;
  latest_campaign: string | null;
  latest_issued_at: Date;
  latest_created_at: Date;
  latest_expires_at: Date;
  latest_accepted_at: Date | null;
  latest_revoked_at: Date | null;
  prior_attempt_count: number;
  alliance_id: string | null;
  alliance_ambiguous: boolean;
  alliance_name: string | null;
  journey_stage: BetaJourneyStage;
  attention_reason: BetaAttentionReason | null;
  attention_since: Date | null;
  latest_status: BetaInvitationAttemptStatus;
};

/** Latest-attempt secrets and operator attribution — hydrated only on paginated list rows. */
type HydratedDerivedRow = DerivedRow & {
  latest_code: string;
  latest_token: string;
  latest_notes: string | null;
  latest_issued_by_user_id: string | null;
  latest_issued_by_display_name: string | null;
  latest_issued_by_email: string | null;
  latest_revoked_by_user_id: string | null;
  latest_revoked_by_display_name: string | null;
  latest_revoked_by_email: string | null;
  latest_accepted_by_user_id: string | null;
  latest_accepted_by_display_name: string | null;
  latest_accepted_by_email: string | null;
};

function mapAttemptOperator(
  userId: string | null | undefined,
  displayName: string | null | undefined,
  email: string | null | undefined,
): BetaAttemptOperator | null {
  if (!userId && !displayName && !email) {
    return null;
  }

  return {
    userId: userId ?? null,
    displayName: displayName ?? null,
    email: email ?? null,
  };
}

function mapDerivedRow(
  row: HydratedDerivedRow,
  origin: string,
): BetaParticipantListItem {
  return {
    participantId: row.participant_id,
    identityAmbiguous: row.identity_ambiguous,
    displayName: row.display_name,
    currentEmail: row.current_email,
    wave: row.latest_campaign,
    journeyStage: row.journey_stage,
    attentionReason: row.attention_reason,
    attentionSince: row.attention_since,
    allianceAmbiguous: row.alliance_ambiguous,
    allianceId: row.alliance_id,
    allianceName: row.alliance_name,
    priorAttemptCount: row.prior_attempt_count,
    latestAttempt: {
      id: row.latest_attempt_id,
      email: row.latest_email,
      code: row.latest_code,
      token: row.latest_token,
      inviteUrl: `${origin}/redeem/${row.latest_token}`,
      status: row.latest_status,
      campaign: row.latest_campaign,
      notes: row.latest_notes,
      issuedAt: row.latest_issued_at,
      createdAt: row.latest_created_at,
      expiresAt: row.latest_expires_at,
      acceptedAt: row.latest_accepted_at,
      revokedAt: row.latest_revoked_at,
      issuedBy: mapAttemptOperator(
        row.latest_issued_by_user_id,
        row.latest_issued_by_display_name,
        row.latest_issued_by_email,
      ),
      revokedBy: mapAttemptOperator(
        row.latest_revoked_by_user_id,
        row.latest_revoked_by_display_name,
        row.latest_revoked_by_email,
      ),
      acceptedBy: mapAttemptOperator(
        row.latest_accepted_by_user_id,
        row.latest_accepted_by_display_name,
        row.latest_accepted_by_email,
      ),
    },
  };
}

function buildFilterSql(
  filters: BetaParticipantFilters,
  searchPattern: string,
  wavePattern: string,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (searchPattern) {
    conditions.push(Prisma.sql`(
      d.display_name ILIKE ${searchPattern} ESCAPE '\\'
      OR d.current_email ILIKE ${searchPattern} ESCAPE '\\'
      OR d.latest_email ILIKE ${searchPattern} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM "BetaInvitation" bi_search
        WHERE bi_search."participantId" = d.participant_id
          AND bi_search.email ILIKE ${searchPattern} ESCAPE '\\'
      )
    )`);
  }

  if (wavePattern) {
    conditions.push(
      Prisma.sql`d.latest_campaign ILIKE ${wavePattern} ESCAPE '\\'`,
    );
  }

  if (filters.journeyStage) {
    conditions.push(Prisma.sql`d.journey_stage = ${filters.journeyStage}`);
  }

  if (filters.attentionReason) {
    conditions.push(Prisma.sql`d.attention_reason = ${filters.attentionReason}`);
  }

  if (conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Paginated participant list with DB-bound filters against the shared CTE.
 * Rows, total count, and summary aggregates come from one SQL round-trip.
 */
export async function listBetaParticipants(
  filters: BetaParticipantFilters,
  page: number,
  pageSize: number,
  now: Date = new Date(),
): Promise<BetaParticipantListResult> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } =
    clampBetaParticipantsPagination(page, pageSize);
  const searchPattern = buildIlikeContainsPattern(filters.search ?? "");
  const wavePattern = buildIlikeContainsPattern(filters.wave ?? "");
  const whereSql = buildFilterSql(filters, searchPattern, wavePattern);
  const origin = getAppOrigin();

  const cte = betaParticipantsDerivationCte(now);

  type UnifiedListRow = HydratedDerivedRow & {
    total: bigint;
    total_participants: bigint;
    needs_attention: bigint;
    alliances_created: bigint;
    alliances_setup_complete: bigint;
    total_invitation_attempts: bigint;
    accepted_participants: bigint;
  };

  const unifiedRows = await prisma.$queryRaw<UnifiedListRow[]>`
    WITH ${cte},
    filtered AS (
      SELECT d.*
      FROM derived d
      WHERE ${whereSql}
    ),
    stats AS (
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*)::bigint AS total_participants,
        COUNT(*) FILTER (WHERE f.attention_reason IS NOT NULL)::bigint AS needs_attention,
        COUNT(DISTINCT f.alliance_id) FILTER (WHERE f.alliance_id IS NOT NULL)::bigint AS alliances_created,
        COUNT(DISTINCT f.alliance_id) FILTER (WHERE f.is_complete)::bigint AS alliances_setup_complete,
        COALESCE(SUM(f.attempt_count), 0)::bigint AS total_invitation_attempts,
        COUNT(*) FILTER (WHERE f.has_accepted)::bigint AS accepted_participants
      FROM filtered f
    ),
    page AS (
      SELECT
        f.participant_id,
        f.identity_ambiguous,
        f.display_name,
        f.current_email,
        f.latest_attempt_id,
        f.latest_email,
        bi.code AS latest_code,
        bi.token AS latest_token,
        f.latest_campaign,
        bi.notes AS latest_notes,
        f.latest_issued_at,
        f.latest_created_at,
        f.latest_expires_at,
        f.latest_accepted_at,
        f.latest_revoked_at,
        bi."issuedByUserId" AS latest_issued_by_user_id,
        issued_by."displayName" AS latest_issued_by_display_name,
        issued_by.email AS latest_issued_by_email,
        bi."revokedByUserId" AS latest_revoked_by_user_id,
        revoked_by."displayName" AS latest_revoked_by_display_name,
        revoked_by.email AS latest_revoked_by_email,
        bi."acceptedByUserId" AS latest_accepted_by_user_id,
        accepted_by."displayName" AS latest_accepted_by_display_name,
        accepted_by.email AS latest_accepted_by_email,
        f.prior_attempt_count,
        f.alliance_id,
        f.alliance_ambiguous,
        f.alliance_name,
        f.journey_stage,
        f.attention_reason,
        f.attention_since,
        f.latest_status
      FROM filtered f
      JOIN "BetaInvitation" bi ON bi.id = f.latest_attempt_id
      LEFT JOIN "User" issued_by ON issued_by.id = bi."issuedByUserId"
      LEFT JOIN "User" revoked_by ON revoked_by.id = bi."revokedByUserId"
      LEFT JOIN "User" accepted_by ON accepted_by.id = bi."acceptedByUserId"
      ORDER BY
        f.latest_issued_at DESC,
        f.latest_created_at DESC,
        f.latest_attempt_id DESC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    ),
    combined AS (
      SELECT
        0 AS row_kind,
        p.participant_id,
        p.identity_ambiguous,
        p.display_name,
        p.current_email,
        p.latest_attempt_id,
        p.latest_email,
        p.latest_code,
        p.latest_token,
        p.latest_campaign,
        p.latest_notes,
        p.latest_issued_at,
        p.latest_created_at,
        p.latest_expires_at,
        p.latest_accepted_at,
        p.latest_revoked_at,
        p.latest_issued_by_user_id,
        p.latest_issued_by_display_name,
        p.latest_issued_by_email,
        p.latest_revoked_by_user_id,
        p.latest_revoked_by_display_name,
        p.latest_revoked_by_email,
        p.latest_accepted_by_user_id,
        p.latest_accepted_by_display_name,
        p.latest_accepted_by_email,
        p.prior_attempt_count,
        p.alliance_id,
        p.alliance_ambiguous,
        p.alliance_name,
        p.journey_stage,
        p.attention_reason,
        p.attention_since,
        p.latest_status,
        s.total,
        s.total_participants,
        s.needs_attention,
        s.alliances_created,
        s.alliances_setup_complete,
        s.total_invitation_attempts,
        s.accepted_participants
      FROM stats s
      INNER JOIN page p ON TRUE
      UNION ALL
      SELECT
        1 AS row_kind,
        NULL AS participant_id,
        NULL AS identity_ambiguous,
        NULL AS display_name,
        NULL AS current_email,
        NULL AS latest_attempt_id,
        NULL AS latest_email,
        NULL AS latest_code,
        NULL AS latest_token,
        NULL AS latest_campaign,
        NULL AS latest_notes,
        NULL AS latest_issued_at,
        NULL AS latest_created_at,
        NULL AS latest_expires_at,
        NULL AS latest_accepted_at,
        NULL AS latest_revoked_at,
        NULL AS latest_issued_by_user_id,
        NULL AS latest_issued_by_display_name,
        NULL AS latest_issued_by_email,
        NULL AS latest_revoked_by_user_id,
        NULL AS latest_revoked_by_display_name,
        NULL AS latest_revoked_by_email,
        NULL AS latest_accepted_by_user_id,
        NULL AS latest_accepted_by_display_name,
        NULL AS latest_accepted_by_email,
        NULL AS prior_attempt_count,
        NULL AS alliance_id,
        NULL AS alliance_ambiguous,
        NULL AS alliance_name,
        NULL AS journey_stage,
        NULL AS attention_reason,
        NULL AS attention_since,
        NULL AS latest_status,
        s.total,
        s.total_participants,
        s.needs_attention,
        s.alliances_created,
        s.alliances_setup_complete,
        s.total_invitation_attempts,
        s.accepted_participants
      FROM stats s
      WHERE NOT EXISTS (SELECT 1 FROM page)
    )
    SELECT
      c.participant_id,
      c.identity_ambiguous,
      c.display_name,
      c.current_email,
      c.latest_attempt_id,
      c.latest_email,
      c.latest_code,
      c.latest_token,
      c.latest_campaign,
      c.latest_notes,
      c.latest_issued_at,
      c.latest_created_at,
      c.latest_expires_at,
      c.latest_accepted_at,
      c.latest_revoked_at,
      c.latest_issued_by_user_id,
      c.latest_issued_by_display_name,
      c.latest_issued_by_email,
      c.latest_revoked_by_user_id,
      c.latest_revoked_by_display_name,
      c.latest_revoked_by_email,
      c.latest_accepted_by_user_id,
      c.latest_accepted_by_display_name,
      c.latest_accepted_by_email,
      c.prior_attempt_count,
      c.alliance_id,
      c.alliance_ambiguous,
      c.alliance_name,
      c.journey_stage,
      c.attention_reason,
      c.attention_since,
      c.latest_status,
      c.total,
      c.total_participants,
      c.needs_attention,
      c.alliances_created,
      c.alliances_setup_complete,
      c.total_invitation_attempts,
      c.accepted_participants
    FROM combined c
    ORDER BY
      c.row_kind ASC,
      c.latest_issued_at DESC NULLS LAST,
      c.latest_created_at DESC NULLS LAST,
      c.latest_attempt_id DESC NULLS LAST
  `;

  const summarySource = unifiedRows[0];
  const total = Number(summarySource?.total ?? BigInt(0));
  const itemRows = unifiedRows.filter(
    (row): row is UnifiedListRow => row.participant_id !== null,
  );

  return {
    items: itemRows.map((row) => mapDerivedRow(row, origin)),
    total,
    page: clampedPage,
    pageSize: clampedPageSize,
    summary: {
      totalParticipants: Number(summarySource?.total_participants ?? BigInt(0)),
      totalInvitationAttempts: Number(
        summarySource?.total_invitation_attempts ?? BigInt(0),
      ),
      acceptedParticipants: Number(
        summarySource?.accepted_participants ?? BigInt(0),
      ),
      needsAttention: Number(summarySource?.needs_attention ?? BigInt(0)),
      distinctAlliancesCreated: Number(
        summarySource?.alliances_created ?? BigInt(0),
      ),
      distinctAlliancesSetupComplete: Number(
        summarySource?.alliances_setup_complete ?? BigInt(0),
      ),
    },
  };
}

type PriorAttemptRow = {
  id: string;
  email: string;
  code: string;
  campaign: string | null;
  notes: string | null;
  issued_at: Date;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  status: BetaInvitationAttemptStatus;
  issued_by_user_id: string | null;
  issued_by_display_name: string | null;
  issued_by_email: string | null;
  revoked_by_user_id: string | null;
  revoked_by_display_name: string | null;
  revoked_by_email: string | null;
  accepted_by_user_id: string | null;
  accepted_by_display_name: string | null;
  accepted_by_email: string | null;
};

function mapPriorAttemptRow(row: PriorAttemptRow): BetaParticipantPriorAttempt {
  return {
    id: row.id,
    email: row.email,
    code: row.code,
    status: row.status,
    campaign: row.campaign,
    notes: row.notes,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    issuedBy: mapAttemptOperator(
      row.issued_by_user_id,
      row.issued_by_display_name,
      row.issued_by_email,
    ),
    revokedBy: mapAttemptOperator(
      row.revoked_by_user_id,
      row.revoked_by_display_name,
      row.revoked_by_email,
    ),
    acceptedBy: mapAttemptOperator(
      row.accepted_by_user_id,
      row.accepted_by_display_name,
      row.accepted_by_email,
    ),
  };
}

/**
 * Paginated prior invitation attempts for one participant (excludes latest).
 */
export async function listBetaParticipantPriorAttempts(
  participantId: string,
  page: number,
  pageSize: number,
  now: Date = new Date(),
): Promise<{ items: BetaParticipantPriorAttempt[]; total: number; page: number; pageSize: number }> {
  const { page: clampedPage, pageSize: clampedPageSize, offset } =
    clampBetaParticipantsPagination(page, pageSize);

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<PriorAttemptRow[]>`
      WITH latest AS (
        SELECT DISTINCT ON (bi."participantId")
          bi.id
        FROM "BetaInvitation" bi
        WHERE bi."participantId" = ${participantId}
        ORDER BY
          bi."participantId",
          bi."issuedAt" DESC,
          bi."createdAt" DESC,
          bi."id" DESC
      )
      SELECT
        bi.id,
        bi.email,
        bi.code,
        bi.campaign,
        bi.notes,
        bi."issuedAt" AS issued_at,
        bi."createdAt" AS created_at,
        bi."expiresAt" AS expires_at,
        bi."acceptedAt" AS accepted_at,
        bi."revokedAt" AS revoked_at,
        bi."issuedByUserId" AS issued_by_user_id,
        issued_by."displayName" AS issued_by_display_name,
        issued_by.email AS issued_by_email,
        bi."revokedByUserId" AS revoked_by_user_id,
        revoked_by."displayName" AS revoked_by_display_name,
        revoked_by.email AS revoked_by_email,
        bi."acceptedByUserId" AS accepted_by_user_id,
        accepted_by."displayName" AS accepted_by_display_name,
        accepted_by.email AS accepted_by_email,
        CASE
          WHEN bi."acceptedAt" IS NOT NULL THEN 'accepted'
          WHEN bi."revokedAt" IS NOT NULL THEN 'revoked'
          WHEN bi."expiresAt" < ${now}::timestamptz THEN 'expired'
          ELSE 'pending'
        END AS status
      FROM "BetaInvitation" bi
      LEFT JOIN "User" issued_by ON issued_by.id = bi."issuedByUserId"
      LEFT JOIN "User" revoked_by ON revoked_by.id = bi."revokedByUserId"
      LEFT JOIN "User" accepted_by ON accepted_by.id = bi."acceptedByUserId"
      WHERE bi."participantId" = ${participantId}
        AND bi.id NOT IN (SELECT id FROM latest)
      ORDER BY
        bi."issuedAt" DESC,
        bi."createdAt" DESC,
        bi.id DESC
      LIMIT ${clampedPageSize}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      WITH latest AS (
        SELECT DISTINCT ON (bi."participantId")
          bi.id
        FROM "BetaInvitation" bi
        WHERE bi."participantId" = ${participantId}
        ORDER BY
          bi."participantId",
          bi."issuedAt" DESC,
          bi."createdAt" DESC,
          bi."id" DESC
      )
      SELECT COUNT(*)::bigint AS total
      FROM "BetaInvitation" bi
      WHERE bi."participantId" = ${participantId}
        AND bi.id NOT IN (SELECT id FROM latest)
    `,
  ]);

  return {
    items: rows.map(mapPriorAttemptRow),
    total: Number(countRows[0]?.total ?? BigInt(0)),
    page: clampedPage,
    pageSize: clampedPageSize,
  };
}

type AttentionDerivedRow = {
  participant_id: string;
  identity_ambiguous: boolean;
  display_name: string | null;
  current_email: string | null;
  latest_email: string;
  alliance_id: string | null;
  alliance_ambiguous: boolean;
  alliance_name: string | null;
  attention_reason: BetaAttentionReason;
  attention_since: Date | null;
  latest_issued_at: Date;
  latest_created_at: Date;
  latest_attempt_id: string;
};

function mapAttentionDerivedRow(
  row: AttentionDerivedRow,
): BetaParticipantAttentionRow {
  return {
    participantId: row.participant_id,
    identityAmbiguous: row.identity_ambiguous,
    displayName: row.display_name,
    currentEmail: row.current_email,
    latestAttemptEmail: row.latest_email,
    attentionReason: row.attention_reason,
    attentionSince: row.attention_since,
    allianceAmbiguous: row.alliance_ambiguous,
    allianceId: row.alliance_id,
    allianceName: row.alliance_name,
  };
}

/**
 * Participants with a non-null attention reason from the shared derivation CTE.
 * Used by the platform Action Required feed — one row per participant.
 * Selects only identity, attention, and alliance fields — no invitation secrets.
 */
export async function listBetaParticipantsNeedingAttention(
  options: { limit?: number; now?: Date } = {},
): Promise<BetaParticipantAttentionRow[]> {
  const now = options.now ?? new Date();
  const limit = Math.min(
    options.limit ?? BETA_PARTICIPANTS_ATTENTION_LIST_LIMIT,
    BETA_PARTICIPANTS_ATTENTION_LIST_LIMIT,
  );
  const cte = betaParticipantsDerivationCte(now);

  const rows = await prisma.$queryRaw<AttentionDerivedRow[]>`
    WITH ${cte}
    SELECT
      d.participant_id,
      d.identity_ambiguous,
      d.display_name,
      d.current_email,
      d.latest_email,
      d.alliance_id,
      d.alliance_ambiguous,
      d.alliance_name,
      d.attention_reason,
      d.attention_since,
      d.latest_issued_at,
      d.latest_created_at,
      d.latest_attempt_id
    FROM derived d
    WHERE d.attention_reason IS NOT NULL
    ORDER BY
      CASE d.attention_reason
        WHEN 'accepted_no_alliance' THEN 1
        WHEN 'setup_stalled' THEN 2
        WHEN 'invitation_expired' THEN 3
        WHEN 'invitation_pending_stale' THEN 4
        ELSE 5
      END ASC,
      d.attention_since ASC NULLS LAST,
      d.latest_issued_at DESC,
      d.latest_created_at DESC,
      d.latest_attempt_id DESC
    LIMIT ${limit}
  `;

  return rows.map(mapAttentionDerivedRow);
}

/** Execute only the derivation CTE for parity testing against TS helpers. */
export async function queryBetaParticipantDerivationForTest(
  now: Date,
): Promise<
  Array<{
    participantId: string;
    allianceId: string | null;
    allianceAmbiguous: boolean;
    isComplete: boolean;
    activeMemberCount: number;
    hasTargetPeriodData: boolean;
    hasAccepted: boolean;
    journeyStage: BetaJourneyStage;
    attentionReason: BetaAttentionReason | null;
    attentionSince: Date | null;
  }>
> {
  const cte = betaParticipantsDerivationCte(now);
  const rows = await prisma.$queryRaw<
    Array<{
      participant_id: string;
      alliance_id: string | null;
      alliance_ambiguous: boolean;
      is_complete: boolean;
      active_member_count: number;
      has_target_period_data: boolean;
      has_accepted: boolean;
      journey_stage: BetaJourneyStage;
      attention_reason: BetaAttentionReason | null;
      attention_since: Date | null;
    }>
  >`
    WITH ${cte}
    SELECT
      d.participant_id,
      d.alliance_id,
      d.alliance_ambiguous,
      d.is_complete,
      d.active_member_count,
      d.has_target_period_data,
      d.has_accepted,
      d.journey_stage,
      d.attention_reason,
      d.attention_since
    FROM derived d
    ORDER BY d.participant_id ASC
  `;

  return rows.map((row) => ({
    participantId: row.participant_id,
    allianceId: row.alliance_id,
    allianceAmbiguous: row.alliance_ambiguous,
    isComplete: row.is_complete,
    activeMemberCount: row.active_member_count,
    hasTargetPeriodData: row.has_target_period_data,
    hasAccepted: row.has_accepted,
    journeyStage: row.journey_stage,
    attentionReason: row.attention_reason,
    attentionSince: row.attention_since,
  }));
}
