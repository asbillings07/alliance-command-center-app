'use client'
import { Metric_Type } from "@/app/generated/prisma/enums";
import { useState } from "react";
import { MetricForm } from "./metricForm";
import { archiveMetric, restoreMetric } from "./action";

type MetricData = {
    id: string;
    name: string;
    description: string | null;
    type: Metric_Type;
    active: boolean;
    metricKey: string;
};

type MetricCardProps = {
    allianceId: string;
    mode: "create" | "view";
    metric?: MetricData;
};

const METRIC_TYPE_LABELS: Record<Metric_Type, { label: string; color: string }> = {
    [Metric_Type.NUMERIC]: { label: "Numeric", color: "bg-blue-100 text-blue-800" },
    [Metric_Type.BOOLEAN]: { label: "Boolean", color: "bg-green-100 text-green-800" },
};

export function MetricCard({ allianceId, mode, metric }: MetricCardProps) {
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
                        + Create Metric
                    </button>
                </div>
            );
        }

        return (
            <div className="w-full max-w-3xl">
                <MetricForm
                    allianceId={allianceId}
                    mode="create"
                    onCancel={() => setCardState("closed")}
                />
            </div>
        );
    }

    // VIEW MODE: Need metric data
    if (!metric) return null;

    const typeInfo = METRIC_TYPE_LABELS[metric.type] || METRIC_TYPE_LABELS[Metric_Type.NUMERIC];

    // VIEW MODE - EDITING: Show edit form
    if (cardState === "form") {
        return (
            <MetricForm
                key={metric.metricKey}
                allianceId={allianceId}
                mode="edit"
                metricId={metric.id}
                name={metric.name}
                description={metric.description || ""}
                type={metric.type}
                onCancel={() => setCardState("view")}
            />
        );
    }

    // VIEW MODE - VIEWING: Show the metric
    return (
        <div className={`w-full rounded-md border p-4 shadow-sm max-w-3xl ${!metric.active ? 'opacity-60 bg-gray-50' : ''}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-lg font-semibold">{metric.name}</h2>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${typeInfo.color}`}>
                            {typeInfo.label}
                        </span>
                        {!metric.active && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600">
                                Archived
                            </span>
                        )}
                    </div>
                    {metric.description && (
                        <p className="text-gray-600">{metric.description}</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {metric.active && (
                        <button
                            type="button"
                            onClick={() => setCardState("form")}
                            className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer"
                        >
                            Edit
                        </button>
                    )}
                    {metric.active ? (
                        <form action={archiveMetric}>
                            <input type="hidden" name="metricId" value={metric.id} />
                            <input type="hidden" name="allianceId" value={allianceId} />
                            <button type="submit" className="text-sm text-amber-600 hover:text-amber-700 cursor-pointer">
                                Archive
                            </button>
                        </form>
                    ) : (
                        <form action={restoreMetric}>
                            <input type="hidden" name="metricId" value={metric.id} />
                            <input type="hidden" name="allianceId" value={allianceId} />
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
