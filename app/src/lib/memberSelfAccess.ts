import "server-only";
import { Prisma, type AllianceRole } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { buildPermissionSet } from "./auth/permissions";
import { readIdentitySnapshot } from "./memberIdentity";

export class MemberAccessError extends Error {}

async function authorizeManager(tx: Prisma.TransactionClient, allianceId: string, actorId: string) {
  const [actor] = await tx.$queryRaw<{ id: string; displayName: string; role: AllianceRole }[]>`
    SELECT u."id", u."displayName", m."role" FROM "AllianceMembership" m
    JOIN "User" u ON u."id" = m."userId"
    WHERE m."allianceId" = ${allianceId} AND m."userId" = ${actorId}
    FOR SHARE OF m, u
  `;
  if (!actor || !buildPermissionSet(actor.role).canManageMemberAccess) {
    throw new MemberAccessError("You do not have permission to manage member access.");
  }
  return actor;
}

async function snapshot(tx: Prisma.TransactionClient, allianceId: string, memberId: string) {
  const identity = await readIdentitySnapshot(tx, allianceId, memberId);
  const decisions = await tx.memberSelfAccessDecision.findMany({
    where: { allianceId, memberId }, orderBy: { id: "desc" }, take: 20,
  });
  const latest = decisions[0];
  const enabled = identity.confirmed && latest?.granted === true
    && latest.accountUserId === identity.member.userId
    && latest.identityDecisionId === identity.decisions[0]?.id;
  return { identity, decisions, enabled,
    reviewKey: JSON.stringify([identity.reviewKey, latest?.id ?? null]) };
}

export async function loadMemberAccessReview(allianceId: string, memberId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await authorizeManager(tx, allianceId, actorId);
    const current = await snapshot(tx, allianceId, memberId);
    const collaborator = current.identity.member.userId ? await tx.allianceMembership.findUnique({
      where: { allianceId_userId: { allianceId, userId: current.identity.member.userId } }, select: { role: true },
    }) : null;
    return { ...current, collaboratorRole: collaborator?.role ?? null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function decideMemberSelfAccess(input: {
  allianceId: string; memberId: string; actorId: string;
  reviewKey: string; grant: boolean; acknowledged: boolean;
}) {
  if (input.acknowledged !== true) throw new MemberAccessError("Confirm that you have reviewed this access decision.");
  if (input.reviewKey.length > 1500) throw new MemberAccessError("Reload and review the current access details.");
  try {
    return await prisma.$transaction(async (tx) => {
      // Same lock as identity changes, with the same isolation/review contract.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`member-identity:${input.memberId}`}, 0))`;
      const actor = await authorizeManager(tx, input.allianceId, input.actorId);
      const current = await snapshot(tx, input.allianceId, input.memberId);
      if (current.reviewKey !== input.reviewKey) throw new MemberAccessError("The identity or access decision changed. Reload and review the current details.");
      const latest = current.decisions[0];
      if (input.grant && !current.identity.confirmed) throw new MemberAccessError("Confirm the current member identity before approving access.");
      if (input.grant && current.enabled) throw new MemberAccessError("Member access is already approved.");
      if (!input.grant && !latest?.granted) throw new MemberAccessError("There is no access approval to revoke.");
      // Revocation refers to the earlier grant, even if the account was relinked.
      const target = input.grant ? {
        accountUserId: current.identity.member.user!.id,
        accountName: current.identity.member.user!.displayName,
        playerName: current.identity.member.playerName,
        identityDecisionId: current.identity.decisions[0].id,
      } : {
        accountUserId: latest.accountUserId, accountName: latest.accountName,
        playerName: latest.playerName, identityDecisionId: latest.identityDecisionId,
      };
      return tx.memberSelfAccessDecision.create({ data: {
        allianceId: input.allianceId, memberId: input.memberId, granted: input.grant,
        ...target, actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new MemberAccessError("Access details changed during this review. Reload and check the current decision before trying again.");
    }
    throw error;
  }
}

async function ownRecord(tx: Prisma.TransactionClient, allianceId: string, userId: string) {
  // The account selects an alliance, never a member ID. Include archived links
  // in ambiguity checks so restoring an old link cannot change who is selected.
  const members = await tx.allianceMember.findMany({ where: { allianceId, userId }, select: { id: true }, take: 2 });
  if (members.length !== 1) return null;
  const current = await snapshot(tx, allianceId, members[0].id);
  if (!current.enabled || current.identity.member.userId !== userId) return null;
  // Strict allowlist: no notes, metrics, account emails, actor/audit information,
  // alternate member identifiers or leadership-only fields leave this service.
  return { allianceId, playerName: current.identity.member.playerName,
    allianceName: current.identity.member.alliance.name, server: current.identity.member.alliance.server };
}

export async function loadOwnMemberRecord(allianceId: string, userId: string) {
  return prisma.$transaction((tx) => ownRecord(tx, allianceId, userId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function listOwnMemberRecords(userId: string) {
  return prisma.$transaction(async (tx) => {
    const links = await tx.allianceMember.findMany({ where: { userId }, distinct: ["allianceId"], select: { allianceId: true } });
    const records = [];
    for (const link of links) {
      const record = await ownRecord(tx, link.allianceId, userId);
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.allianceName.localeCompare(b.allianceName));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
