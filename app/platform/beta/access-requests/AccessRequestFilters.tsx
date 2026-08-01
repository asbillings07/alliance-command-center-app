"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Input, Label } from "@/app/src/components/client";
import type { AccessRequestInboxFilters } from "@/app/src/lib/platform/accessRequestInbox";
import { ACCESS_REQUEST_STATUS_LABELS, ALL_ACCESS_REQUEST_STATUSES } from "./labels";

type AccessRequestFiltersProps = {
  filters: AccessRequestInboxFilters;
  page: number;
  pageSize: number;
  total: number;
};

const BASE_PATH = "/platform/beta/access-requests";

export function AccessRequestFilters({ filters, page, pageSize, total }: AccessRequestFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
      const query = params.toString();
      router.push(query ? `${BASE_PATH}?${query}` : BASE_PATH);
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    navigate({
      status: (formData.get("status") as string) || undefined,
      search: (formData.get("search") as string) || undefined,
      page: undefined,
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            name="search"
            defaultValue={filters.search ?? ""}
            placeholder="Name or email"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={filters.status ?? ""}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All statuses</option>
            {ALL_ACCESS_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ACCESS_REQUEST_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" loading={isPending}>
            Apply filters
          </Button>
        </div>
      </form>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <span>
            Page {page} of {totalPages} ({total} item{total === 1 ? "" : "s"})
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
