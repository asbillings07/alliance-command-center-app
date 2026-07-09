"use server";

import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";
import { normalizeName } from "@/app/src/lib/memberMatcher";

export type AddMemberResult =
    | { success: true; memberId: string }
    | { success: false; error: string }
    | { success: false; archivedMember: { id: string; playerName: string; archivedAt: Date } };

export async function addMember(formData: FormData): Promise<AddMemberResult> {
    const allianceId = formData.get("allianceId") as string;
    const playerName = (formData.get("playerName") as string)?.trim();
    const thpRaw = formData.get("thp") as string;
    const squadPowerRaw = formData.get("squadPower") as string;
    const role = (formData.get("role") as string)?.trim() || null;

    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    if (!playerName) {
        return { success: false, error: "Player name is required" };
    }

    const normalizedInput = normalizeName(playerName);

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
            // Return archived member info for smart restore prompt
            return {
                success: false,
                archivedMember: {
                    id: existingMember.id,
                    playerName: existingMember.playerName,
                    archivedAt: existingMember.archivedAt,
                },
            };
        } else {
            return {
                success: false,
                error: `A member named "${existingMember.playerName}" already exists in this alliance`,
            };
        }
    }

    // Parse numeric fields
    const thp = thpRaw ? parseInt(thpRaw.replace(/,/g, ""), 10) || null : null;
    const squadPower = squadPowerRaw ? parseInt(squadPowerRaw.replace(/,/g, ""), 10) || null : null;

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
}

export async function restoreMember(formData: FormData): Promise<AddMemberResult> {
    const allianceId = formData.get("allianceId") as string;
    const memberId = formData.get("memberId") as string;

    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

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
    return { success: true, memberId: member.id };
}
