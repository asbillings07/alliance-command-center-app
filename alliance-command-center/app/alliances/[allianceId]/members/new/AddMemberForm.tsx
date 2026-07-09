"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMember, restoreMember } from "./action";

interface AddMemberFormProps {
    allianceId: string;
}

export function AddMemberForm({ allianceId }: AddMemberFormProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [archivedPrompt, setArchivedPrompt] = useState<{
        id: string;
        playerName: string;
        archivedAt: string;
    } | null>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);
        setArchivedPrompt(null);

        startTransition(async () => {
            const result = await addMember(formData);

            if (result.success) {
                router.push(`/alliances/${allianceId}/members/${result.memberId}`);
            } else if ("archivedMember" in result) {
                setArchivedPrompt(result.archivedMember);
            } else {
                setError(result.error);
            }
        });
    }

    async function handleRestore() {
        if (!archivedPrompt) return;

        setError(null);

        const formData = new FormData();
        formData.set("allianceId", allianceId);
        formData.set("memberId", archivedPrompt.id);

        startTransition(async () => {
            const result = await restoreMember(formData);

            if (result.success) {
                router.push(`/alliances/${allianceId}/members/${result.memberId}`);
            } else if ("error" in result) {
                setError(result.error);
            }
        });
    }

    function handleCancelRestore() {
        setArchivedPrompt(null);
    }

    if (archivedPrompt) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-amber-800 mb-2">
                    Archived Member Found
                </h2>
                <p className="text-amber-700 mb-4">
                    A member named <strong>{archivedPrompt.playerName}</strong> was
                    previously archived on{" "}
                    {new Date(archivedPrompt.archivedAt).toLocaleDateString()}. Would you
                    like to restore them instead of creating a new record?
                </p>
                <p className="text-sm text-amber-600 mb-6">
                    Restoring will preserve their historical metrics and leadership notes.
                </p>
                <div className="flex gap-3">
                    <button
                        onClick={handleRestore}
                        disabled={isPending}
                        className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                    >
                        {isPending ? "Restoring..." : "Restore Member"}
                    </button>
                    <button
                        onClick={handleCancelRestore}
                        disabled={isPending}
                        className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <form action={handleSubmit} className="space-y-4">
            <input type="hidden" name="allianceId" value={allianceId} />

            {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
                    {error}
                </div>
            )}

            <div>
                <label
                    htmlFor="playerName"
                    className="block text-sm font-medium text-gray-700 mb-1"
                >
                    Player Name <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    id="playerName"
                    name="playerName"
                    required
                    autoFocus
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter player name"
                />
            </div>

            <div>
                <label
                    htmlFor="thp"
                    className="block text-sm font-medium text-gray-700 mb-1"
                >
                    Total Hero Power
                </label>
                <input
                    type="text"
                    id="thp"
                    name="thp"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 52,000,000"
                />
            </div>

            <div>
                <label
                    htmlFor="squadPower"
                    className="block text-sm font-medium text-gray-700 mb-1"
                >
                    Top Squad Power
                </label>
                <input
                    type="text"
                    id="squadPower"
                    name="squadPower"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 15,000,000"
                />
            </div>

            <div>
                <label
                    htmlFor="role"
                    className="block text-sm font-medium text-gray-700 mb-1"
                >
                    Role
                </label>
                <input
                    type="text"
                    id="role"
                    name="role"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., R4, Officer"
                />
            </div>

            <div className="flex gap-3 pt-4">
                <button
                    type="submit"
                    disabled={isPending}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                    {isPending ? "Adding..." : "Add Member"}
                </button>
                <button
                    type="button"
                    onClick={() => router.back()}
                    disabled={isPending}
                    className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
