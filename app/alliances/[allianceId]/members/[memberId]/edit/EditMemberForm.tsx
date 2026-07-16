"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMember } from "../member-actions";
import { formatPower } from "@/app/src/lib/formatPower";
import { Button, Input, Label } from "@/app/src/components";

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
                <div className="p-3 bg-danger/10 border border-danger text-danger rounded-md text-sm">
                    {error}
                </div>
            )}

            <div>
                <Label htmlFor="playerName" required>
                    Player Name
                </Label>
                <Input
                    type="text"
                    id="playerName"
                    name="playerName"
                    required
                    defaultValue={defaultValues.playerName}
                />
            </div>

            <div>
                <Label htmlFor="thp">Total Hero Power</Label>
                <Input
                    type="text"
                    id="thp"
                    name="thp"
                    defaultValue={defaultValues.thp != null ? formatPower(defaultValues.thp) : ""}
                    placeholder="e.g., 52,000,000"
                />
            </div>

            <div>
                <Label htmlFor="squadPower">Top Squad Power</Label>
                <Input
                    type="text"
                    id="squadPower"
                    name="squadPower"
                    defaultValue={defaultValues.squadPower != null ? formatPower(defaultValues.squadPower) : ""}
                    placeholder="e.g., 15,000,000"
                />
            </div>

            <div>
                <Label htmlFor="role">Role</Label>
                <Input
                    type="text"
                    id="role"
                    name="role"
                    defaultValue={defaultValues.role || ""}
                    placeholder="e.g., R4, Officer"
                />
            </div>

            <div className="flex gap-3 pt-4">
                <Button
                    type="submit"
                    variant="primary"
                    loading={isPending}
                >
                    {isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={() => router.back()}
                    disabled={isPending}
                >
                    Cancel
                </Button>
            </div>
        </form>
    );
}
