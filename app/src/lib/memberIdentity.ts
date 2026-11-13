import "server-only";
import { Prisma, type AllianceRole } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { buildPermissionSet } from "./auth/permissions";

export class IdentityReviewError extends Error {}

async function review(tx: Prisma.TransactionClient, allianceId: string, memberId: string) {
  const member = await tx.allianceMember.findFirst({
    where: { id: memberId, allianceId },
    select: { id: true, playerName: true, userId: true, archivedAt: true, identityVersion: true,
      user: { select: { id: true, displayName: true, email: true } },
      alliance: { select: { name: true, server: true, identityVersion: true } } },
  });
  if (!member) throw new IdentityReviewError("Member not found.");
  const decisions = await tx.memberIdentityDecision.findMany({ where: { allianceId, memberId }, orderBy: { id: "desc" }, take: 20 });
  const linkedCount = member.userId ? await tx.allianceMember.count({ where: { allianceId, userId: member.userId } }) : 0;
  const missing: string[] = [];
  if (member.archivedAt) missing.push("This member is archived. Restore the member before confirming identity.");
  if (!member.playerName.trim()) missing.push("A current in-game name is required.");
  if (!member.alliance.name.trim() || !member.alliance.server.trim()) missing.push("Alliance and server information is required.");
  if (!member.user) missing.push("No account is linked to this member. An account link must be established before identity can be confirmed.");
  else if (linkedCount !== 1) missing.push("This account is linked to more than one member in this alliance. Resolve the account links before confirming identity.");
  const latest = decisions[0];
  const confirmed = missing.length === 0 && !!latest?.confirmed
    && latest.accountUserId === member.userId
    && latest.memberVersion === member.identityVersion
    && latest.allianceVersion === member.alliance.identityVersion;
  // Not a credential: exact review context for optimistic stale-form rejection.
  const reviewKey = JSON.stringify([member.identityVersion, member.alliance.identityVersion, member.userId, linkedCount, latest?.id ?? null]);
  return { member, decisions, missing, confirmed, reviewKey };
}

async function authorize(tx: Prisma.TransactionClient, allianceId: string, actorId: string) {
  const [actor] = await tx.$queryRaw<{ id: string; displayName: string; role: AllianceRole }[]>`
    SELECT u."id", u."displayName", m."role" FROM "AllianceMembership" m
    JOIN "User" u ON u."id" = m."userId"
    WHERE m."allianceId" = ${allianceId} AND m."userId" = ${actorId}
    FOR SHARE OF m, u
  `;
  if (!actor || !buildPermissionSet(actor.role).canManageMembers) {
    throw new IdentityReviewError("You do not have permission to review this member's identity.");
  }
  return actor;
}

export async function loadIdentityReview(allianceId: string, memberId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await authorize(tx, allianceId, actorId);
    return review(tx, allianceId, memberId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function decideMemberIdentity(input: {
  allianceId: string; memberId: string; actorId: string;
  reviewKey: string; confirm: boolean; acknowledged: boolean;
}) {
  if (!input.acknowledged) throw new IdentityReviewError("Confirm that you have reviewed this decision.");
  if (input.reviewKey.length > 1000) throw new IdentityReviewError("Reload this review and try again.");
  try {
    return await prisma.$transaction(async (tx) => {
      // Serializes decisions about one member without locking roster rows in a
      // conflicting order. Serializable isolation covers identity/link reads.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`member-identity:${input.memberId}`}, 0))`;
      const actor = await authorize(tx, input.allianceId, input.actorId);
      const current = await review(tx, input.allianceId, input.memberId);
      if (current.reviewKey !== input.reviewKey) throw new IdentityReviewError("This member's identity or decision history changed. Reload and review the current details.");
      if (input.confirm && current.missing.length) throw new IdentityReviewError(current.missing[0]);
      if (input.confirm && current.confirmed) throw new IdentityReviewError("This identity is already confirmed.");
      if (!input.confirm && !current.decisions[0]?.confirmed) throw new IdentityReviewError("There is no confirmation to revoke.");
      return tx.memberIdentityDecision.create({ data: {
        allianceId: input.allianceId, memberId: input.memberId, confirmed: input.confirm,
        accountUserId: current.member.userId, playerName: current.member.playerName,
        allianceName: current.member.alliance.name, server: current.member.alliance.server,
        memberVersion: current.member.identityVersion, allianceVersion: current.member.alliance.identityVersion,
        actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new IdentityReviewError("The record changed during this review. Reload and check the current decision before trying again.");
    }
    throw error;
  }
}
