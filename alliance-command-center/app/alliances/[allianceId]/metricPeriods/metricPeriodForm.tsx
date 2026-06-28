'use client'
import { useTransition } from "react";
import { createMetricPeriod, editMetricPeriod } from "./action";

type MetricPeriodFormProps = {
    allianceId: string;
    mode: "create" | "edit";
    periodId?: string;
    name?: string;
    startsAt?: string;
    endsAt?: string;
    onCancel: () => void;
};

function formatDateForInput(date: string | null | undefined): string {
    if (!date) return "";
    return date;
}

export function MetricPeriodForm({
    allianceId,
    mode,
    periodId,
    name = "",
    startsAt,
    endsAt,
    onCancel,
}: MetricPeriodFormProps) {
    const [isPending, startTransition] = useTransition();
    const action = mode === "create" ? createMetricPeriod : editMetricPeriod;
    const submitLabel = mode === "create" ? "Create Period" : "Update Period";

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
            try {
                await action(formData);
                onCancel();
            } catch (error) {
                console.error("Failed to save:", error);
            }
        });
    };

    return (
        <form className="w-full rounded-md border p-4 shadow-sm flex flex-col gap-3 max-w-3xl" onSubmit={handleSubmit}>
            <input type="hidden" name="allianceId" value={allianceId} />
            {mode === "edit" && periodId && <input type="hidden" name="periodId" value={periodId} />}

            <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                </label>
                <input
                    id="name"
                    name="name"
                    type="text"
                    defaultValue={name}
                    className="w-full rounded-md border border-gray-300 p-2"
                    placeholder="e.g., Season 7, Q1 2026"
                    required
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label htmlFor="startsAt" className="block text-sm font-medium text-gray-700 mb-1">
                        Start Date (optional)
                    </label>
                    <input
                        id="startsAt"
                        name="startsAt"
                        type="date"
                        defaultValue={formatDateForInput(startsAt)}
                        className="w-full rounded-md border border-gray-300 p-2"
                    />
                </div>

                <div>
                    <label htmlFor="endsAt" className="block text-sm font-medium text-gray-700 mb-1">
                        End Date (optional)
                    </label>
                    <input
                        id="endsAt"
                        name="endsAt"
                        type="date"
                        defaultValue={formatDateForInput(endsAt)}
                        className="w-full rounded-md border border-gray-300 p-2"
                    />
                </div>
            </div>

            <div className="flex gap-2 justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={isPending}
                    className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPending ? "Saving..." : submitLabel}
                </button>
            </div>
        </form>
    );
}
