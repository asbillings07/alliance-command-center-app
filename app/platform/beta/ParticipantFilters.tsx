"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Input, Label } from "@/app/src/components/client";
import type {
  BetaAttentionReason,
  BetaJourneyStage,
} from "@/app/src/lib/platform/betaParticipants";
import {
  journeyStageLabels,
  attentionLabels,
} from "./ParticipantList";

type ParticipantFiltersProps = {
  search: string;
  wave: string;
  journeyStage: BetaJourneyStage | "";
  attentionReason: BetaAttentionReason | "";
  page: number;
  pageSize: number;
  total: number;
};

export function ParticipantFilters({
  search,
  wave,
  journeyStage,
  attentionReason,
  page,
  pageSize,
  total,
}: ParticipantFiltersProps) {
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
      router.push(query ? `/platform/beta?${query}` : "/platform/beta");
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    navigate({
      search: (formData.get("search") as string) || undefined,
      wave: (formData.get("wave") as string) || undefined,
      journeyStage: (formData.get("journeyStage") as string) || undefined,
      attentionReason: (formData.get("attentionReason") as string) || undefined,
      page: undefined,
    });
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div>
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            name="search"
            defaultValue={search}
            placeholder="Name or email"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="wave">Beta wave</Label>
          <Input
            id="wave"
            name="wave"
            defaultValue={wave}
            placeholder="Campaign / wave"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="journeyStage">Journey stage</Label>
          <select
            id="journeyStage"
            name="journeyStage"
            defaultValue={journeyStage}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">All stages</option>
            {Object.entries(journeyStageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="attentionReason">Attention</Label>
          <select
            id="attentionReason"
            name="attentionReason"
            defaultValue={attentionReason}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Any</option>
            {Object.entries(attentionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <Button type="submit" variant="secondary" loading={isPending}>
            Apply filters
          </Button>
        </div>
      </form>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <span>
            Page {page} of {totalPages} ({total} participant
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
