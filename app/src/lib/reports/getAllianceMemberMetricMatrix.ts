import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import type { Metric_Type } from "@/app/generated/prisma/enums";
import { prisma } from "@/app/src/lib/prisma";
import {
  normalizeFilter,
  clampPageSize,
  clampRequestedPage,
  resolvePageAgainstTotal,
  boundSearchInput,
  buildSearchPattern,
  type MemberRosterFilter,
} from "@/app/src/lib/reports/getMetricSummaryReport";
import {
  resolveMatrixColumns,
  normalizeMatrixSort,
  buildCell,
  type MatrixColumnCandidate,
  type MatrixSortKey,
  type MatrixRow,
  type AllianceMemberMetricMatrix,
} from "@/app/src/lib/reports/allianceMemberMatrix";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";

/**
 * Bounded member-by-metric matrix read model (#264 PR3).
 *
 * Deliberately separate from `getAlliancePerformanceReport` (which computes
 * full-cohort *aggregates* for every configured metric) — this answers a
 * different question ("show me these members' actual values across a
 * chosen handful of metrics") with a different bounding strategy
 * (paginated members × a capped column selection, never the full metric
 * library × full roster).
 *
 * Column universe is *not* re-queried here: the caller (the `/reports` page)
 * already computed the exact same metric universe via
 * `getAlliancePerformanceReport`, in the exact same stable order (active
 * first, then name, then id) — passing that list in as `candidates` avoids
 * a second, potentially-inconsistent metric query and guarantees "anything
 * on the report can be a matrix column" by construction, not by convention.
 *
 * Three bounded DB round-trips drive the body, all scoped to only the
 * *selected* columns (never the full metric library):
 *   1. A count query, for pagination against the filtered/searched roster.
 *   2. A roster query (CTE-joined against the selected columns' latest
 *      values, for the archived-inclusion check and any metric-based sort)
 *      — paginated, filtered, searched, sorted.
 *   3. A cell-value fetch, via the canonical read model (#287 Slice 3),
 *      grouped in JS into one cell per (row, column) - filtered down to
 *      exactly this page's members afterward. This one is no longer
 *      bounded to `pageSize × MATRIX_MAX_COLUMNS` rows at the query level
 *      (see `queryMatrixCells`'s doc comment); only the *result* used by
 *      this function is bounded to that.
 *
 * Pure types/logic (column resolution, sort normalization, cell status)
 * live in `./allianceMemberMatrix` — this file is the DB orchestration only,
 * so client components (the column chooser/controls) can import the pure
 * side without pulling Prisma/`pg` into the browser bundle.
 *
 * #287 Slice 3 (partial): only round-trip 3 above has migrated to
 * `memberPeriodMetricValues` (ADR-018 §6). Round-trips 1-2's
 * `selected_values` CTE (archived-inclusion + metric-sort tiering, computed
 * over the *whole* roster before pagination) still reads raw
 * `MemberMetricEntry` rows directly - migrating it requires either fetching
 * every member's cross-joined value into JS to sort/paginate there (the
 * unbounded-in-memory anti-pattern this project is otherwise eliminating)
 * or extracting `memberPeriodMetricValues`' CTE chain into a reusable SQL
 * fragment this file's own paginated/sorted query can compose with. Both
 * are deliberately deferred (see
 * `docs/database-design/287-slice3-consumer-parity-log.md`): this gap is
 * inert today, since no leader can create a `DAILY_OBSERVATION` metric yet,
 * so archived-inclusion and metric-sort already agree with the canonical
 * model for every metric that exists in production.
 */

// Re-exported for convenience so most callers only need one import path.
export {
  MATRIX_MAX_COLUMNS,
  resolveMatrixColumns,
  normalizeMatrixSort,
  buildCell,
  type MatrixColumnCandidate,
  type MatrixSortKey,
  type MatrixCellStatus,
  type MatrixCell,
  type MatrixRow,
  type AllianceMemberMetricMatrix,
} from "@/app/src/lib/reports/allianceMemberMatrix";

type MatrixRosterQueryParams = {
  allianceId: string;
  periodId: string;
  columnIds: string[];
  filter: MemberRosterFilter;
  searchPattern: string;
  sort: MatrixSortKey;
  sortColumnType?: Metric_Type;
};

/**
 * `selected_values`: latest value per (metric, member) across only the
 * *selected* columns — shared by the archived-inclusion check below and by
 * a metric-based sort's value/tier. `member_has_selected_value` backs the
 * "archived member is only included if they contributed to a *currently
 * visible* column" rule (#264 PR3) — a contribution to some other metric in
 * the library that isn't a selected column shouldn't pull an otherwise
 * irrelevant archived row into view.
 */
function buildMatrixCte(params: MatrixRosterQueryParams): Prisma.Sql {
  const { periodId, columnIds } = params;
  return Prisma.sql`
    WITH selected_values AS (
      SELECT DISTINCT ON ("metricId", "allianceMemberId")
        "metricId" AS metric_id, "allianceMemberId" AS member_id, value
      FROM "MemberMetricEntry"
      WHERE "periodId" = ${periodId} AND "metricId" IN (${Prisma.join(columnIds)})
      ORDER BY "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, id DESC
    ),
    member_has_selected_value AS (
      SELECT DISTINCT member_id FROM selected_values WHERE value IS NOT NULL
    )
  `;
}

function buildMatrixFromWhere(params: MatrixRosterQueryParams): Prisma.Sql {
  const { allianceId, filter, searchPattern, sort } = params;
  const sortMetricId = sort.kind === "metric" ? sort.metricId : null;
  return Prisma.sql`
    FROM "AllianceMember" am
    LEFT JOIN selected_values sv ON sv.member_id = am.id AND sv.metric_id = ${sortMetricId}
    WHERE am."allianceId" = ${allianceId}
      AND (
        (${filter}::text = 'active' AND am."archivedAt" IS NULL)
        OR (${filter}::text = 'archived' AND am."archivedAt" IS NOT NULL AND EXISTS (
          SELECT 1 FROM member_has_selected_value h WHERE h.member_id = am.id
        ))
        OR (${filter}::text = 'all' AND (am."archivedAt" IS NULL OR EXISTS (
          SELECT 1 FROM member_has_selected_value h WHERE h.member_id = am.id
        )))
      )
      AND (${searchPattern}::text = '' OR am."playerName" ILIKE ${searchPattern} ESCAPE '\\')
  `;
}

/**
 * Name sort ties break by id only (member id order is already stable and
 * unique). A metric sort buckets into three fixed tiers regardless of
 * direction — valid (0), invalid (1), missing (2) — so "invalid follows
 * valid" and "missing is always last" hold in both ascending and
 * descending order; only the ordering *within* the valid tier flips with
 * direction. Ties within any tier (including invalid/missing, where every
 * row's orderable value is identically NULL) fall through to name, then id
 * (#264 PR3 decision).
 */
function buildMatrixOrderBy(sort: MatrixSortKey, sortColumnType?: Metric_Type): Prisma.Sql {
  if (sort.kind === "name") {
    return sort.direction === "desc"
      ? Prisma.sql`am."playerName" DESC, am.id ASC`
      : Prisma.sql`am."playerName" ASC, am.id ASC`;
  }

  const isBoolean = sortColumnType === "BOOLEAN";
  const tier = Prisma.sql`(
    CASE
      WHEN sv.value IS NULL THEN 2
      WHEN ${isBoolean}::boolean AND sv.value NOT IN (0, 1) THEN 1
      ELSE 0
    END
  )`;
  const orderableValue = Prisma.sql`(CASE WHEN ${tier} = 0 THEN sv.value END)`;

  return sort.direction === "desc"
    ? Prisma.sql`${tier} ASC, ${orderableValue} DESC NULLS LAST, am."playerName" ASC, am.id ASC`
    : Prisma.sql`${tier} ASC, ${orderableValue} ASC NULLS LAST, am."playerName" ASC, am.id ASC`;
}

async function countMatrixRosterRows(params: MatrixRosterQueryParams): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    ${buildMatrixCte(params)}
    SELECT COUNT(*)::bigint AS total
    ${buildMatrixFromWhere(params)}
  `;
  return Number(rows[0]?.total ?? BigInt(0));
}

type MatrixRosterRawRow = { alliance_member_id: string; player_name: string; archived: boolean };

async function queryMatrixRoster(
  params: MatrixRosterQueryParams,
  pageSize: number,
  offset: number,
): Promise<MatrixRosterRawRow[]> {
  return prisma.$queryRaw<MatrixRosterRawRow[]>`
    ${buildMatrixCte(params)}
    SELECT am.id AS alliance_member_id, am."playerName" AS player_name, (am."archivedAt" IS NOT NULL) AS archived
    ${buildMatrixFromWhere(params)}
    ORDER BY ${buildMatrixOrderBy(params.sort, params.sortColumnType)}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
}

type MatrixCellValue = { metricId: string; memberId: string; value: number | null };

/**
 * #287 Slice 3: cell values now come from the canonical read model
 * (ADR-018 §6) instead of a raw `DISTINCT ON` over `MemberMetricEntry`, so
 * a `DAILY_OBSERVATION + SUM/AVERAGE` column correctly shows its rolled-up
 * value rather than only its latest single day's raw entry (a divergence
 * that is inert today - no leader can create a `DAILY_OBSERVATION` metric
 * yet; see `docs/database-design/287-slice3-consumer-parity-log.md`).
 *
 * `onlyParticipating: true` matches the previous query's own behavior
 * exactly: it never returned a row for a (metric, member) with zero
 * entries either, relying on `buildCell`'s `?? null` fallback for those.
 *
 * No longer bounded to exactly this page's members at the query level:
 * `memberPeriodMetricValues` has no member filter (matching every other
 * consumer's use of it), so it cross-joins the *full* roster against the
 * selected columns, and only the *returned result* is filtered down to
 * `memberIds` in JS. At this product's alliance-size scale (bounded by
 * `MATRIX_MAX_COLUMNS` columns), the full-roster fetch is the same order of
 * magnitude already proved acceptable by
 * `memberPeriodRollupTenantIsolationAndPerformance.integration.test.ts` -
 * but if alliance sizes grow enough for this to matter, the fix is a member
 * filter on `memberPeriodMetricValues` itself, not a workaround here.
 */
async function queryMatrixCells(
  allianceId: string,
  periodId: string,
  metricIds: string[],
  memberIds: string[],
): Promise<MatrixCellValue[]> {
  if (metricIds.length === 0 || memberIds.length === 0) return [];
  const memberIdSet = new Set(memberIds);
  const values = await memberPeriodMetricValues(allianceId, periodId, metricIds, {
    onlyParticipating: true,
  });
  return values
    .filter((row) => memberIdSet.has(row.allianceMemberId))
    .map((row) => ({ metricId: row.metricId, memberId: row.allianceMemberId, value: row.value }));
}

/**
 * The bounded member-by-metric matrix for one period (#264 PR3).
 *
 * Tenant scoping: `allianceId` is trusted from the caller, same as every
 * other alliance-scoped read model — callers (server actions/pages) must
 * already have verified the acting user has access to it. `candidates` is
 * assumed to already be this alliance/period's own metric universe (see
 * module doc comment); this function never queries `Metric` itself.
 */
export async function getAllianceMemberMetricMatrix(params: {
  allianceId: string;
  periodId: string;
  candidates: readonly MatrixColumnCandidate[];
  requestedColumnIds?: readonly string[];
  filter?: MemberRosterFilter | string | null;
  search?: string | null;
  sort?: string | null;
  sortDirection?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): Promise<AllianceMemberMetricMatrix> {
  const { allianceId, periodId, candidates } = params;

  const columns = resolveMatrixColumns(candidates, params.requestedColumnIds);
  const filter = normalizeFilter(params.filter);
  const boundedSearch = boundSearchInput(params.search);
  const searchPattern = buildSearchPattern(params.search);
  const pageSize = clampPageSize(params.pageSize);
  const requestedPage = clampRequestedPage(params.page);
  const sort = normalizeMatrixSort(params.sort, params.sortDirection, columns);

  // Only reachable when `candidates` itself is empty (zero reportable
  // metrics) — the page already renders its own empty state before this
  // point in that case, so this is defensive, not a real code path today.
  if (columns.length === 0) {
    return {
      columns: [],
      availableColumns: candidates as MatrixColumnCandidate[],
      rows: [],
      pagination: { page: 1, pageSize, totalRowCount: 0 },
      sort,
      filter,
      search: boundedSearch,
    };
  }

  const columnIds = columns.map((column) => column.id);
  const sortColumn = sort.kind === "metric" ? columns.find((column) => column.id === sort.metricId) : undefined;

  const queryParams: MatrixRosterQueryParams = {
    allianceId,
    periodId,
    columnIds,
    filter,
    searchPattern,
    sort,
    sortColumnType: sortColumn?.type,
  };

  const totalRowCount = await countMatrixRosterRows(queryParams);
  const page = resolvePageAgainstTotal(requestedPage, totalRowCount, pageSize);
  const offset = (page - 1) * pageSize;

  const rosterRows = await queryMatrixRoster(queryParams, pageSize, offset);
  const memberIds = rosterRows.map((row) => row.alliance_member_id);

  const cellValues = await queryMatrixCells(allianceId, periodId, columnIds, memberIds);
  const cellsByMember = new Map<string, Map<string, number | null>>();
  for (const cell of cellValues) {
    if (!cellsByMember.has(cell.memberId)) cellsByMember.set(cell.memberId, new Map());
    cellsByMember.get(cell.memberId)!.set(cell.metricId, cell.value);
  }

  const rows: MatrixRow[] = rosterRows.map((row) => ({
    allianceMemberId: row.alliance_member_id,
    playerName: row.player_name,
    archived: row.archived,
    cells: columns.map((column) =>
      buildCell(column, cellsByMember.get(row.alliance_member_id)?.get(column.id) ?? null),
    ),
  }));

  return {
    columns,
    availableColumns: candidates as MatrixColumnCandidate[],
    rows,
    pagination: { page, pageSize, totalRowCount },
    sort,
    filter,
    search: boundedSearch,
  };
}
