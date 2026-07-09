"use server";

import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";

export type MemberActionResult =
    | { success: true }
    | { success: false; error: string };

export async function archiveMember(
    formData: FormData
): Promise<MemberActionResult> {
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

    if (member.archivedAt) {
        return { success: false, error: "Member is already archived" };
    }

    await prisma.allianceMember.update({
        where: { id: memberId },
        data: { archivedAt: new Date() },
    });

    revalidatePath(`/alliances/${allianceId}/members`);
    revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
    return { success: true };
}

export async function restoreMember(
    formData: FormData
): Promise<MemberActionResult> {
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
    revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
    return { success: true };
}

export async function updateMember(
    formData: FormData
): Promise<MemberActionResult> {
    const allianceId = formData.get("allianceId") as string;
    const memberId = formData.get("memberId") as string;
    const playerName = (formData.get("playerName") as string)?.trim();
    const thpRaw = formData.get("thp") as string;
    const squadPowerRaw = formData.get("squadPower") as string;
    const role = (formData.get("role") as string)?.trim() || null;

    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);

    if (!playerName) {
        return { success: false, error: "Player name is required" };
    }

    const member = await prisma.allianceMember.findUnique({
        where: { id: memberId },
    });

    if (!member || member.allianceId !== allianceId) {
        return { success: false, error: "Member not found" };
    }

    if (member.archivedAt) {
        return { success: false, error: "Cannot edit an archived member. Restore them first." };
    }

    // Check for name conflicts if name changed
    if (playerName.toLowerCase() !== member.playerName.toLowerCase()) {
        const existingMember = await prisma.allianceMember.findFirst({
            where: {
                allianceId,
                playerName: {
                    equals: playerName,
                    mode: "insensitive",
                },
                id: { not: memberId },
            },
        });

        if (existingMember) {
            return {
                success: false,
                error: `A member named "${existingMember.playerName}" already exists`,
            };
        }
    }

    const thp = thpRaw ? parseInt(thpRaw.replace(/,/g, ""), 10) || null : null;
    const squadPower = squadPowerRaw
        ? parseInt(squadPowerRaw.replace(/,/g, ""), 10) || null
        : null;

    await prisma.allianceMember.update({
        where: { id: memberId },
        data: {
            playerName,
            thp,
            squadPower,
            role,
        },
    });

    revalidatePath(`/alliances/${allianceId}/members`);
    revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
    return { success: true };
}
