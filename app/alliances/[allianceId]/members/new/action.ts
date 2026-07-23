"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";

export class ArchivedMemberError extends Error {
    constructor(
        public readonly memberId: string,
        public readonly playerName: string,
        public readonly archivedAtIso: string
    ) {
        super("Archived member found");
        this.name = "ArchivedMemberError";
    }
}

export type AddMemberResult =
    | { success: true; memberId: string }
    | { success: false; error: string }
    | { success: false; archivedMember: { id: string; playerName: string; archivedAt: string } };

function parseIntOrNull(value: string | undefined): number | null {
    if (!value) return null;
    const cleaned = value.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    return Number.isFinite(num) ? num : null;
}

export async function addMember(formData: FormData): Promise<AddMemberResult> {
    const allianceId = formData.get("allianceId");
    const playerName = (formData.get("playerName") as string | null)?.trim();
    const thpRaw = (formData.get("thp") as string | null) ?? "";
    const squadPowerRaw = (formData.get("squadPower") as string | null) ?? "";
    const role = (formData.get("role") as string | null)?.trim() || null;

    if (typeof allianceId !== "string" || allianceId.trim() === "") {
        return { success: false, error: "Invalid alliance" };
    }

    const auth = await requireAllianceAccess({ allianceId });

    if (!auth.permissions.canManageMembers) {
        return { success: false, error: "You don't have permission to add members" };
    }

    if (!playerName) {
        return { success: false, error: "Player name is required" };
    }

    // Parse numeric fields (preserves 0 as valid value)
    const thp = parseIntOrNull(thpRaw);
    const squadPower = parseIntOrNull(squadPowerRaw);

    try {
        const member = await withAllianceMemberLock(
            allianceId,
            async (tx, activeMembersCount) => {
                const existingInTx = await tx.allianceMember.findFirst({
                    where: {
                        allianceId,
                        playerName: {
                            equals: playerName,
                            mode: "insensitive",
                        },
                    },
                });

                if (existingInTx) {
                    if (existingInTx.archivedAt) {
                        throw new ArchivedMemberError(
                            existingInTx.id,
                            existingInTx.playerName,
                            existingInTx.archivedAt.toISOString()
                        );
                    } else {
                        throw new Error(`A member named "${existingInTx.playerName}" already exists in this alliance`);
                    }
                }

                if (activeMembersCount + 1 > 100) {
                    throw new Error("Your alliance has 100 active members, so you can add 0 more.");
                }

                return await tx.allianceMember.create({
                    data: {
                        allianceId,
                        playerName,
                        thp,
                        squadPower,
                        role,
                        joinedAt: new Date(),
                    },
                });
            }
        );

        revalidatePath(`/alliances/${allianceId}/members`);
        return { success: true, memberId: member.id };
    } catch (error) {
        if (error instanceof ArchivedMemberError) {
            return {
                success: false,
                archivedMember: {
                    id: error.memberId,
                    playerName: error.playerName,
                    archivedAt: error.archivedAtIso,
                },
            };
        }
        if (error instanceof Error && (error.message.includes("already exists") || error.message.includes("active members"))) {
            return { success: false, error: error.message };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return { success: false, error: "A member with this name already exists" };
        }
        throw error;
    }
}

export async function restoreMember(formData: FormData): Promise<AddMemberResult> {
    const allianceId = formData.get("allianceId");
    const memberId = formData.get("memberId");

    if (
        typeof allianceId !== "string" ||
        allianceId.trim() === "" ||
        typeof memberId !== "string" ||
        memberId.trim() === ""
    ) {
        return { success: false, error: "Invalid request" };
    }

    const auth = await requireAllianceAccess({ allianceId });

    if (!auth.permissions.canManageMembers) {
        return { success: false, error: "You don't have permission to restore members" };
    }

    try {
        const member = await withAllianceMemberLock(
            allianceId,
            async (tx, activeMembersCount) => {
                const targetMember = await tx.allianceMember.findFirst({
                    where: { id: memberId, allianceId },
                });

                if (!targetMember) {
                    throw new Error("Member not found");
                }

                if (!targetMember.archivedAt) {
                    throw new Error("Member is not archived");
                }

                if (activeMembersCount + 1 > 100) {
                    throw new Error("Your alliance has 100 active members, so you can add 0 more.");
                }

                return await tx.allianceMember.update({
                    where: { id: memberId },
                    data: { archivedAt: null },
                });
            }
        );

        revalidatePath(`/alliances/${allianceId}/members`);
        revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
        return { success: true, memberId: member.id };
    } catch (error) {
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        throw error;
    }
}
