"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMember, restoreMember } from "./action";
import { Card } from "@/app/src/components";
import { Button, Input, Label } from "@/app/src/components/client";

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
            <Card className="bg-warning/10 border-warning">
                <Card.Body>
                    <h2 className="text-lg font-semibold text-warning mb-2">
                        Archived Member Found
                    </h2>
                    <p className="text-warning/90 mb-4">
                        A member named <strong>{archivedPrompt.playerName}</strong> was
                        previously archived on{" "}
                        {new Date(archivedPrompt.archivedAt).toLocaleDateString()}. Would you
                        like to restore them instead of creating a new record?
                    </p>
                    <p className="text-sm text-warning/80 mb-6">
                        Restoring will preserve their historical metrics and leadership notes.
                    </p>
                    <div className="flex gap-3">
                        <Button
                            variant="warning"
                            onClick={handleRestore}
                            loading={isPending}
                        >
                            {isPending ? "Restoring..." : "Restore Member"}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={handleCancelRestore}
                            disabled={isPending}
                        >
                            Cancel
                        </Button>
                    </div>
                </Card.Body>
            </Card>
        );
    }

    return (
        <form action={handleSubmit} className="space-y-4">
            <input type="hidden" name="allianceId" value={allianceId} />

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
                    autoFocus
                    placeholder="Enter player name"
                />
            </div>

            <div>
                <Label htmlFor="thp">Total Hero Power</Label>
                <Input
                    type="text"
                    id="thp"
                    name="thp"
                    placeholder="e.g., 52,000,000"
                />
            </div>

            <div>
                <Label htmlFor="squadPower">Top Squad Power</Label>
                <Input
                    type="text"
                    id="squadPower"
                    name="squadPower"
                    placeholder="e.g., 15,000,000"
                />
            </div>

            <div>
                <Label htmlFor="role">Role</Label>
                <Input
                    type="text"
                    id="role"
                    name="role"
                    placeholder="e.g., R4, Officer"
                />
            </div>

            <div className="flex gap-3 pt-4">
                <Button
                    type="submit"
                    variant="primary"
                    loading={isPending}
                >
                    {isPending ? "Adding..." : "Add Member"}
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
