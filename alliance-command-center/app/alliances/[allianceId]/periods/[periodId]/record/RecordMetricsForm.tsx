'use client'
import { useState, useTransition } from "react";
import { recordMemberMetrics } from "./action";

type Member = {
    id: string;
    playerName: string;
};

type Metric = {
    id: string;
    name: string;
};

type RecordMetricsFormProps = {
    periodId: string;
    allianceId: string;
    members: Member[];
    metrics: Metric[];
};

export function RecordMetricsForm({ periodId, allianceId, members, metrics }: RecordMetricsFormProps) {
    const [selectedMetricId, setSelectedMetricId] = useState(metrics[0]?.id || "");
    const [isPending, startTransition] = useTransition();
    const [values, setValues] = useState<Record<string, string>>({});

    const handleValueChange = (memberId: string, value: string) => {
        setValues((prev) => ({ ...prev, [memberId]: value }));
    };

    const handleSubmit = (e: React.BaseSyntheticEvent) => {
        e.preventDefault();
        
        const entries = Object.entries(values)
            .filter(([_, value]) => value !== "")
            .map(([memberId, value]) => ({
                memberId,
                value: parseInt(value, 10),
            }));

        if (entries.length === 0) {
            alert("Please enter at least one value");
            return;
        }

        startTransition(async () => {
            try {
                await recordMemberMetrics({
                    periodId,
                    metricId: selectedMetricId,
                    allianceId,
                    entries,
                });
                setValues({});
                alert("Metrics recorded successfully!");
            } catch (error) {
                console.error("Failed to record metrics:", error);
                alert("Failed to record metrics");
            }
        });
    };

    const selectedMetric = metrics.find((m) => m.id === selectedMetricId);

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-4">
            <div>
                <label htmlFor="metricId" className="block text-sm font-medium text-gray-700 mb-1">
                    Select Metric
                </label>
                <select
                    name="metricId"
                    id="metricId"
                    value={selectedMetricId}
                    onChange={(e) => {
                        setSelectedMetricId(e.target.value);
                        setValues({});
                    }}
                    className="w-full rounded-md border border-gray-300 p-2"
                >
                    {metrics.map((metric) => (
                        <option key={metric.id} value={metric.id}>{metric.name}</option>
                    ))}
                </select>
            </div>

            <hr className="border-gray-200" />

            <h3 className="text-lg font-semibold">
                Record {selectedMetric?.name || "Metric"} for Members
            </h3>

            <div className="flex flex-col gap-2">
                {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between p-3 border rounded-md">
                        <label htmlFor={`value-${member.id}`} className="font-medium">
                            {member.playerName}
                        </label>
                        <input
                            type="text"
                            id={member.id}
                            value={values[member.id] || ""}
                            onChange={(e) => handleValueChange(member.id, e.target.value)}
                            placeholder="Enter value"
                            className="w-32 rounded-md border border-gray-300 p-2 text-right"
                        />
                    </div>
                ))}
            </div>

            <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isPending ? "Saving..." : "Save All"}
            </button>
        </form>
    );
}
