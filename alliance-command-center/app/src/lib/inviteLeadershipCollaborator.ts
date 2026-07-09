import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import type { AllianceRole, Invitation, AllianceMember } from "@/app/generated/prisma/client";

export type InviteLeadershipInput = {
  allianceId: string;
  invitedById: string;
  existingMemberId?: string;
  playerName: string;
  email: string;
  membershipRole: AllianceRole;
  thp?: number | null;
  squadPower?: number | null;
};

export type InviteLeadershipResult = {
  invitation: Invitation;
  member: AllianceMember;
  memberCreated: boolean;
  inviteUrl: string;
  inviteCode: string;
};

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(9); // 9 bytes for 9 characters
  const segment = (offset: number) =>
    Array.from(
      { length: 3 },
      (_, i) => chars[bytes[offset + i] % chars.length]
    ).join("");
  return `${segment(0)}-${segment(3)}-${segment(6)}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function findPendingInvitation(
  allianceId: string,
  email: string
): Promise<Invitation | null> {
  return prisma.invitation.findFirst({
    where: {
      allianceId,
      email: { equals: email, mode: "insensitive" },
      acceptedAt: null,
      cancelledAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function findMemberByName(
  allianceId: string,
  playerName: string
): Promise<AllianceMember | null> {
  return prisma.allianceMember.findFirst({
    where: {
      allianceId,
      playerName: { equals: playerName, mode: "insensitive" },
      archivedAt: null,
    },
  });
}

export async function findMemberById(
  memberId: string
): Promise<AllianceMember | null> {
  return prisma.allianceMember.findUnique({
    where: { id: memberId },
  });
}

export async function searchMembers(
  allianceId: string,
  query: string
): Promise<Pick<AllianceMember, "id" | "playerName">[]> {
  if (!query.trim()) {
    return prisma.allianceMember.findMany({
      where: {
        allianceId,
        archivedAt: null,
        userId: null, // Only show members not yet connected to a user
      },
      select: { id: true, playerName: true },
      orderBy: { playerName: "asc" },
      take: 20,
    });
  }

  return prisma.allianceMember.findMany({
    where: {
      allianceId,
      archivedAt: null,
      userId: null, // Only show members not yet connected to a user
      playerName: { contains: query, mode: "insensitive" },
    },
    select: { id: true, playerName: true },
    orderBy: { playerName: "asc" },
    take: 20,
  });
}

export async function inviteLeadershipCollaborator(
  input: InviteLeadershipInput
): Promise<InviteLeadershipResult> {
  const {
    allianceId,
    invitedById,
    existingMemberId,
    playerName,
    email,
    membershipRole,
    thp,
    squadPower,
  } = input;

  const pending = await findPendingInvitation(allianceId, email);
  if (pending) {
    throw new Error("A pending invitation already exists for this email");
  }

  const existingMembership = await prisma.allianceMembership.findFirst({
    where: {
      allianceId,
      user: { email: { equals: email, mode: "insensitive" } },
    },
  });
  if (existingMembership) {
    throw new Error("This email already has access to this alliance");
  }

  let member: AllianceMember;
  let memberCreated = false;

  if (existingMemberId) {
    const found = await findMemberById(existingMemberId);
    if (!found) {
      throw new Error("Selected member not found");
    }
    if (found.allianceId !== allianceId) {
      throw new Error("Selected member does not belong to this alliance");
    }
    if (found.userId) {
      throw new Error("This member is already connected to a user account");
    }
    member = found;
  } else {
    member = await prisma.allianceMember.create({
      data: {
        allianceId,
        playerName,
        thp,
        squadPower,
      },
    });
    memberCreated = true;
  }

  const token = randomUUID();
  const code = generateInviteCode();

  const invitation = await prisma.invitation.create({
    data: {
      allianceId,
      invitedById,
      allianceMemberId: member.id,
      playerNameSnapshot: member.playerName,
      email,
      membershipRole,
      token,
      code,
      expiresAt: addDays(new Date(), 7),
    },
  });

  const origin = process.env.NEXTAUTH_URL || "http://localhost:3000";

  return {
    invitation,
    member,
    memberCreated,
    inviteUrl: `${origin}/invite/${token}`,
    inviteCode: code,
  };
}

export async function cancelInvitation(invitationId: string): Promise<Invitation> {
  return prisma.invitation.update({
    where: { id: invitationId },
    data: { cancelledAt: new Date() },
  });
}

export async function resendInvitation(invitationId: string): Promise<{
  invitation: Invitation;
  inviteUrl: string;
  inviteCode: string;
}> {
  const newToken = randomUUID();
  const newCode = generateInviteCode();

  const invitation = await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      token: newToken,
      code: newCode,
      expiresAt: addDays(new Date(), 7),
      cancelledAt: null,
    },
  });

  const origin = process.env.NEXTAUTH_URL || "http://localhost:3000";

  return {
    invitation,
    inviteUrl: `${origin}/invite/${newToken}`,
    inviteCode: newCode,
  };
}
