"use server";

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";

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

    // Check for existing member (active or archived)
    const existingMember = await prisma.allianceMember.findFirst({
        where: {
            allianceId,
            playerName: {
                equals: playerName,
                mode: "insensitive",
            },
        },
    });

    if (existingMember) {
        if (existingMember.archivedAt) {
            // Return archived member info for smart restore prompt (serialize Date to ISO string)
            return {
                success: false,
                archivedMember: {
                    id: existingMember.id,
                    playerName: existingMember.playerName,
                    archivedAt: existingMember.archivedAt.toISOString(),
                },
            };
        } else {
            return {
                success: false,
                error: `A member named "${existingMember.playerName}" already exists in this alliance`,
            };
        }
    }

    // Parse numeric fields (preserves 0 as valid value)
    const thp = parseIntOrNull(thpRaw);
    const squadPower = parseIntOrNull(squadPowerRaw);

    try {
        const member = await prisma.allianceMember.create({
            data: {
                allianceId,
                playerName,
                thp,
                squadPower,
                role,
                joinedAt: new Date(),
            },
        });

        revalidatePath(`/alliances/${allianceId}/members`);
        return { success: true, memberId: member.id };
    } catch (error) {
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

    const member = await prisma.allianceMember.findUnique({
        where: { id: memberId },
    });

    if (!member || member.allianceId !== allianceId) {
        return { success: false, error: "Member not found" };
    }

    if (!member.archivedAt) {
        return { success: false, error: "Member is not archived" };
    }

    await prisma.allianceMember.update({
        where: { id: memberId },
        data: { archivedAt: null },
    });

    revalidatePath(`/alliances/${allianceId}/members`);
    revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
    return { success: true, memberId: member.id };
}
