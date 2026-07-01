'use client'
import { Metric } from "@/app/generated/prisma/client";
import { useRef, useTransition } from "react";
import { addMetricToPeriod } from "./action";

type AddMetricFormProps = {
    metrics: Pick<Metric, "id" | "name">[];
    periodId: string;
}

export function AddMetricForm({ metrics, periodId }: AddMetricFormProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [isPending, startTransition] = useTransition();

    const openDialog = () => dialogRef.current?.showModal();
    const closeDialog = () => dialogRef.current?.close();

    const handleSubmit = (e: React.BaseSyntheticEvent) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        formData.append("periodId", periodId);
        
        startTransition(async () => {
            try {
                await addMetricToPeriod(formData);
                formRef.current?.reset();
                closeDialog();
            } catch (error) {
                console.error("Failed to add metric:", error);
            }
        });
    };

    return (
        <>
            <button
                className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                onClick={openDialog}
            >
                Add Metric
            </button>

            <dialog
                ref={dialogRef}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-0 backdrop:bg-black/50 max-w-md w-full m-0"
            >
                <form ref={formRef} className="p-6 flex flex-col gap-4" onSubmit={handleSubmit}>
                    <h2 className="text-lg font-semibold">Add Metric to Period</h2>
                    
                    <div>
                        <label htmlFor="metricId" className="block text-sm font-medium text-gray-700 mb-1">
                            Metric
                        </label>
                        <select
                            name="metricId"
                            id="metricId"
                            className="w-full rounded-md border border-gray-300 p-2"
                            required
                        >
                            <option value="">Select a metric</option>
                            {metrics.map((metric) => (
                                <option key={metric.id} value={metric.id}>{metric.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">
                            Weight (0-100)
                        </label>
                        <input
                            type="number"
                            name="weight"
                            id="weight"
                            min="0"
                            max="100"
                            className="w-full rounded-md border border-gray-300 p-2"
                            required
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            name="required"
                            id="required"
                            className="rounded border-gray-300"
                        />
                        <label htmlFor="required" className="text-sm text-gray-700">
                            Required
                        </label>
                    </div>

                    <div className="flex gap-2 justify-end mt-2">
                        <button
                            type="button"
                            onClick={closeDialog}
                            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending ? "Saving..." : "Save"}
                        </button>
                    </div>
                </form>
            </dialog>
        </>
    );
}