"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button, Input, Label, Select, Checkbox } from "@/app/src/components/client";
import type { MemberRosterFilter } from "@/app/src/lib/reports/getMetricSummaryReport";
import {
  MATRIX_MAX_COLUMNS,
  type MatrixColumnCandidate,
  type MatrixSortKey,
} from "@/app/src/lib/reports/allianceMemberMatrix";
import { formatMatrixColumnChooserLabel } from "./allianceMemberMatrixDisplay";

type Props = {
  allianceId: string;
  availableColumns: MatrixColumnCandidate[];
  selectedColumnIds: string[];
  sort: MatrixSortKey;
  filter: MemberRosterFilter;
  search: string;
  page: number;
  pageSize: number;
  totalRowCount: number;
};

const FILTER_LABELS: Record<MemberRosterFilter, string> = {
  active: "Active members",
  archived: "Archived contributors",
  all: "All members",
};

/**
 * URL-driven controls for the member matrix (#264 PR3) — column chooser,
 * search/filter/sort, and pagination — all in one form/submit, mirroring
 * `MetricReportFilterControls`'s established pattern. All `matrix*` params
 * live alongside (never replace) the page's own `periodId`/`comparePeriodId`
 * — `navigate` starts from the current URL and only touches the keys it's
 * given, so the shared comparison period a leader is looking at survives
 * every matrix-only interaction.
 */
export function AllianceMemberMatrixControls({
  allianceId,
  availableColumns,
  selectedColumnIds,
  sort,
  filter,
  search,
  page,
  pageSize,
  totalRowCount,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(selectedColumnIds));
  const [sortValue, setSortValue] = useState<string>(sort.kind === "name" ? "name" : sort.metricId);

  const basePath = `/alliances/${allianceId}/reports`;
  const totalPages = Math.max(1, Math.ceil(totalRowCount / pageSize));
  const atColumnLimit = checkedIds.size >= MATRIX_MAX_COLUMNS;

  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (!("matrixPage" in updates)) {
      params.delete("matrixPage");
    }
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
    });
  };

  const toggleColumn = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      if (checked && prev.size >= MATRIX_MAX_COLUMNS) return prev;
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    // A column that's about to be unchecked can no longer be a valid sort
    // target — the server would silently fall back to name anyway, but
    // resetting here keeps the "Sort by" dropdown from offering a metric
    // that's no longer selected.
    if (!checked && sortValue === id) {
      setSortValue("name");
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    navigate({
      matrixColumns: Array.from(checkedIds).join(",") || undefined,
      matrixSearch: (formData.get("matrixSearch") as string) || undefined,
      matrixFilter: (formData.get("matrixFilter") as string) || undefined,
      matrixSort: sortValue === "name" ? undefined : sortValue,
      matrixSortDir: (formData.get("matrixSortDir") as string) || undefined,
      matrixPage: undefined,
    });
  };

  // Only currently-checked, currently-sortable columns can be a sort
  // target (#264 PR3 decision) — mirrors `normalizeMatrixSort` server-side.
  const sortableColumns = availableColumns.filter(
    (column) => checkedIds.has(column.id) && column.attachmentStatus === "ACTIVE",
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="matrix-controls-form">
        <fieldset>
          <legend className="text-sm font-medium text-text-secondary mb-2">
            Columns ({checkedIds.size} of {MATRIX_MAX_COLUMNS})
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2" data-testid="matrix-column-chooser">
            {availableColumns.map((column) => {
              const checked = checkedIds.has(column.id);
              return (
                <Checkbox
                  key={column.id}
                  id={`matrix-column-${column.id}`}
                  label={formatMatrixColumnChooserLabel(column)}
                  checked={checked}
                  disabled={isPending || (!checked && atColumnLimit)}
                  onChange={(e) => toggleColumn(column.id, e.target.checked)}
                  data-testid={`matrix-column-checkbox-${column.id}`}
                />
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="matrix-search">Search</Label>
            <Input
              id="matrix-search"
              name="matrixSearch"
              defaultValue={search}
              placeholder="Player name"
              disabled={isPending}
            />
          </div>
          <div>
            <Label htmlFor="matrix-filter">Roster</Label>
            <Select id="matrix-filter" name="matrixFilter" defaultValue={filter} disabled={isPending}>
              {(Object.keys(FILTER_LABELS) as MemberRosterFilter[]).map((value) => (
                <option key={value} value={value}>
                  {FILTER_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="matrix-sort">Sort by</Label>
            <Select
              id="matrix-sort"
              value={sortValue}
              onChange={(e) => setSortValue(e.target.value)}
              disabled={isPending}
            >
              <option value="name">Member name</option>
              {sortableColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="matrix-sort-dir">Direction</Label>
            <Select id="matrix-sort-dir" name="matrixSortDir" defaultValue={sort.direction} disabled={isPending}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Select>
          </div>
        </div>

        <Button type="submit" variant="secondary" loading={isPending}>
          Apply
        </Button>
      </form>

      {totalRowCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <span>
            Page {page} of {totalPages} ({totalRowCount} member{totalRowCount === 1 ? "" : "s"})
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending || page <= 1}
              onClick={() => navigate({ matrixPage: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending || page >= totalPages}
              onClick={() => navigate({ matrixPage: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
