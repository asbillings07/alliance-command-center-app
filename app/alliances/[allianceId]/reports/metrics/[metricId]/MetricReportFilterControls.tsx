"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Input, Label, Select } from "@/app/src/components/client";
import type { MemberRosterFilter, MetricReportSort } from "@/app/src/lib/reports/getMetricSummaryReport";

type Props = {
  allianceId: string;
  metricId: string;
  sort: MetricReportSort;
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

const SORT_LABELS: Record<MetricReportSort, string> = {
  value_desc: "Value (high to low)",
  value_asc: "Value (low to high)",
  name_asc: "Name (A–Z)",
};

/**
 * Search/filter/sort + pagination for the metric report's member roster
 * (#190). Mirrors the platform Access Request queue's URL-driven pattern
 * (`AccessRequestFilters.tsx`) — display state lives entirely in the URL, so
 * it survives refresh/back-navigation and is directly linkable.
 */
export function MetricReportFilterControls({
  allianceId,
  metricId,
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

  const totalPages = Math.max(1, Math.ceil(totalRowCount / pageSize));
  const basePath = `/alliances/${allianceId}/reports/metrics/${metricId}`;

  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (!("page" in updates)) {
      params.delete("page");
    }
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    navigate({
      search: (formData.get("search") as string) || undefined,
      filter: (formData.get("filter") as string) || undefined,
      sort: (formData.get("sort") as string) || undefined,
      page: undefined,
    });
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
        data-testid="report-filter-form"
      >
        <div>
          <Label htmlFor="report-search">Search</Label>
          <Input id="report-search" name="search" defaultValue={search} placeholder="Player name" disabled={isPending} />
        </div>
        <div>
          <Label htmlFor="report-filter">Roster</Label>
          <Select id="report-filter" name="filter" defaultValue={filter} disabled={isPending}>
            {(Object.keys(FILTER_LABELS) as MemberRosterFilter[]).map((value) => (
              <option key={value} value={value}>
                {FILTER_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="report-sort">Sort</Label>
          <Select id="report-sort" name="sort" defaultValue={sort} disabled={isPending}>
            {(Object.keys(SORT_LABELS) as MetricReportSort[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" loading={isPending}>
            Apply
          </Button>
        </div>
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
              onClick={() => navigate({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending || page >= totalPages}
              onClick={() => navigate({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
