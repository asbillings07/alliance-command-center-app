"use server";

import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { prisma } from "@/app/src/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma";

export type MemberActionResult =
    | { success: true }
    | { success: false; error: string };

function parseIntOrNull(value: string | undefined): number | null {
    if (!value) return null;
    const cleaned = value.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    return Number.isFinite(num) ? num : null;
}

export async function archiveMember(
    formData: FormData
): Promise<MemberActionResult> {
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
    const allianceId = formData.get("allianceId");
    const memberId = formData.get("memberId");
    const playerName = (formData.get("playerName") as string | null)?.trim();
    const thpRaw = (formData.get("thp") as string | null) ?? "";
    const squadPowerRaw = (formData.get("squadPower") as string | null) ?? "";
    const role = (formData.get("role") as string | null)?.trim() || null;

    if (
        typeof allianceId !== "string" ||
        allianceId.trim() === "" ||
        typeof memberId !== "string" ||
        memberId.trim() === ""
    ) {
        return { success: false, error: "Invalid request" };
    }

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

    // Parse numeric fields (preserves 0 as valid value)
    const thp = parseIntOrNull(thpRaw);
    const squadPower = parseIntOrNull(squadPowerRaw);

    try {
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
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return { success: false, error: "A member with this name already exists" };
        }
        throw error;
    }
}
