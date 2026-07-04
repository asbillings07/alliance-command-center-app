'use client'
import { useState } from "react";
import { MetricPeriodForm } from "./metricPeriodForm";
import { archiveMetricPeriod, restoreMetricPeriod } from "./action";
import { MetricPeriodMetric } from "@/app/generated/prisma/client";
import { Metric } from "@/app/generated/prisma/client";
import Link from "next/link";

type MetricPeriodData = {
    id: string;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
    active: boolean;
    periodKey: string;
    periodMetrics: (MetricPeriodMetric & { metric: Metric })[];
};

type MetricPeriodCardProps = {
    allianceId: string;
    mode: "create" | "view";
    period?: MetricPeriodData;
};

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "Not set";
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString();
}

export function MetricPeriodCard({ allianceId, mode, period }: MetricPeriodCardProps) {
    const [cardState, setCardState] = useState<"closed" | "form" | "view">(
        mode === "create" ? "closed" : "view"
    );

    // CREATE MODE: Show button or create form
    if (mode === "create") {
        if (cardState === "closed") {
            return (
                <div className="w-full max-w-3xl">
                    <button
                        type="button"
                        onClick={() => setCardState("form")}
                        className="w-full rounded-md border-2 border-dashed border-gray-300 p-4 text-gray-500 hover:border-blue-400 hover:text-blue-500 cursor-pointer"
                    >
                        + Create Period
                    </button>
                </div>
            );
        }

        return (
            <div className="w-full max-w-3xl">
                <MetricPeriodForm
                    allianceId={allianceId}
                    mode="create"
                    onCancel={() => setCardState("closed")}
                />
            </div>
        );
    }

    // VIEW MODE: Need period data
    if (!period) return null;

    // VIEW MODE - EDITING: Show edit form
    if (cardState === "form") {
        return (
            <MetricPeriodForm
                key={period.periodKey}
                allianceId={allianceId}
                mode="edit"
                periodId={period.id}
                name={period.name}
                startsAt={period.startsAt || undefined}
                endsAt={period.endsAt || undefined}
                onCancel={() => setCardState("view")}
            />
        );
    }

    // VIEW MODE - VIEWING: Show the period
    return (
        <div className={`w-full rounded-md border p-4 shadow-sm max-w-3xl ${!period.active ? 'opacity-60 bg-gray-50' : ''}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-lg font-semibold">{period.name}</h2>
                        {!period.active && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600">
                                Archived
                            </span>
                        )}
                    </div>
                    <div className="text-sm text-gray-600 flex gap-4">
                        <span>Start: {formatDate(period.startsAt)}</span>
                        <span>End: {formatDate(period.endsAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link href={`/alliances/${allianceId}/periods/${period.id}`} className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer">Configure Metrics</Link>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {period.active && (
                        <button
                            type="button"
                            onClick={() => setCardState("form")}
                            className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer"
                        >
                            Edit
                        </button>
                    )}
                    {period.active ? (
                        <form action={archiveMetricPeriod}>
                            <input type="hidden" name="periodId" value={period.id} />
                            <button type="submit" className="text-sm text-amber-600 hover:text-amber-700 cursor-pointer">
                                Archive
                            </button>
                        </form>
                    ) : (
                        <form action={restoreMetricPeriod}>
                            <input type="hidden" name="periodId" value={period.id} />
                            <button type="submit" className="text-sm text-green-600 hover:text-green-700 cursor-pointer">
                                Restore
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
