"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMember } from "../memberActions";
import { formatPower } from "@/app/src/lib/formatPower";

interface EditMemberFormProps {
    allianceId: string;
    memberId: string;
    defaultValues: {
        playerName: string;
        thp: number | null;
        squadPower: number | null;
        role: string | null;
    };
}

export function EditMemberForm({
    allianceId,
    memberId,
    defaultValues,
}: EditMemberFormProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);

        startTransition(async () => {
            const result = await updateMember(formData);

            if (result.success) {
                router.push(`/alliances/${allianceId}/members/${memberId}`);
            } else {
                setError(result.error);
            }
        });
    }

    return (
        <form action={handleSubmit} className="space-y-4">
            <input type="hidden" name="allianceId" value={allianceId} />
            <input type="hidden" name="memberId" value={memberId} />

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
                    defaultValue={defaultValues.playerName}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    defaultValue={defaultValues.thp ? formatPower(defaultValues.thp) : ""}
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
                    defaultValue={
                        defaultValues.squadPower
                            ? formatPower(defaultValues.squadPower)
                            : ""
                    }
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
                    defaultValue={defaultValues.role || ""}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., R4, Officer"
                />
            </div>

            <div className="flex gap-3 pt-4">
                <button
                    type="submit"
                    disabled={isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                    {isPending ? "Saving..." : "Save Changes"}
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
