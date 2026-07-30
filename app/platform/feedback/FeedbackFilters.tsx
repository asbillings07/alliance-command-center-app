"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Input, Label } from "@/app/src/components/client";
import { FEEDBACK_CATEGORY_OPTIONS } from "@/app/src/lib/feedbackCategory";
import type {
  FeedbackInboxFilterOption,
  FeedbackInboxFilters,
} from "@/app/src/lib/platform/feedbackInbox";
import { appendOutOfCapOption } from "./filterOptions";

type FeedbackFiltersProps = {
  filters: FeedbackInboxFilters;
  allianceOptions: FeedbackInboxFilterOption[];
  waveOptions: FeedbackInboxFilterOption[];
  page: number;
  pageSize: number;
  total: number;
};

export function FeedbackFilters({
  filters,
  allianceOptions,
  waveOptions,
  page,
  pageSize,
  total,
}: FeedbackFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const alliances = appendOutOfCapOption(allianceOptions, filters.allianceId);
  const waves = appendOutOfCapOption(waveOptions, filters.wave);

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
      router.push(query ? `/platform/feedback?${query}` : "/platform/feedback");
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    navigate({
      category: (formData.get("category") as string) || undefined,
      allianceId: (formData.get("allianceId") as string) || undefined,
      participantId: (formData.get("participantId") as string) || undefined,
      wave: (formData.get("wave") as string) || undefined,
      needsResponse: (formData.get("needsResponse") as string) || undefined,
      search: (formData.get("search") as string) || undefined,
      page: undefined,
    });
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <div>
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            name="search"
            defaultValue={filters.search ?? ""}
            placeholder="Submitter, email, or message"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            name="category"
            defaultValue={filters.category ?? ""}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All categories</option>
            {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="allianceId">Alliance</Label>
          <select
            id="allianceId"
            name="allianceId"
            defaultValue={filters.allianceId ?? ""}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All alliances</option>
            {alliances.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="participantId">Participant ID</Label>
          <Input
            id="participantId"
            name="participantId"
            defaultValue={filters.participantId ?? ""}
            placeholder="Beta participant ID"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="wave">Wave</Label>
          <select
            id="wave"
            name="wave"
            defaultValue={filters.wave ?? ""}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All waves</option>
            {waves.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="needsResponse">Needs response</Label>
          <select
            id="needsResponse"
            name="needsResponse"
            defaultValue={
              filters.needsResponse === undefined
                ? ""
                : filters.needsResponse
                  ? "true"
                  : "false"
            }
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Any</option>
            <option value="true">Needs response</option>
            <option value="false">No response needed</option>
          </select>
        </div>
        <div className="md:col-span-2 lg:col-span-3">
          <Button type="submit" variant="secondary" loading={isPending}>
            Apply filters
          </Button>
        </div>
      </form>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <span>
            Page {page} of {totalPages} ({total} item
            {total === 1 ? "" : "s"})
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
