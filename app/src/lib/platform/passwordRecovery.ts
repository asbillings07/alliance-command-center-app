import "server-only";
import { prisma } from "../prisma";
import { verifyPassword } from "../account";
import { createPasswordResetTokenInTransaction } from "../passwordReset";
import { normalizeEmail } from "../emailAddress";

const RECOVERY_TTL_MS = 15 * 60 * 1000;
const REISSUE_INTERVAL_MS = 60 * 1000;

type LockedUser = {
  id: string; email: string; displayName: string; passwordHash: string | null;
  isPlatformAdmin: boolean; sessionVersion: number;
};

/** Call only after platform-admin authorization. Explicit projection excludes credentials. */
export async function getPasswordRecoveryAccount(query: { userId?: string; email?: string }) {
  if (!query.userId && !query.email) return null;
  const user = await prisma.user.findUnique({
    where: query.userId ? { id: query.userId } : { email: normalizeEmail(query.email!) },
    select: {
      id: true, email: true, displayName: true, passwordHash: true, isPlatformAdmin: true,
      memberships: { select: { alliance: { select: { id: true, name: true } } }, take: 5 },
    },
  });
  if (!user) return null;
  const events = await prisma.passwordRecoveryEvent.findMany({
    where: { targetUserId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
    select: { id: true, actorName: true, createdAt: true, expiresAt: true },
  });
  return {
    id: user.id, email: user.email, displayName: user.displayName,
    hasPassword: user.passwordHash !== null, isPlatformAdmin: user.isPlatformAdmin,
    alliances: user.memberships.map((m) => m.alliance), events,
  };
}

export type AssistedRecoveryInput = {
  targetUserId: string;
  expectedEmail: string;
  operatorPassword: string;
  identityConfirmed: boolean;
};
export type AssistedRecoveryResult =
  | { ok: true; rawToken: string; expiresAt: Date }
  | { ok: false; error: string };

/** Reauthentication, current authorization, token and audit commit as one operation. */
export async function issueAssistedPasswordReset(actorId: string, input: AssistedRecoveryInput): Promise<AssistedRecoveryResult> {
  const fail = (error: string): AssistedRecoveryResult => ({ ok: false, error });
  if (!input.identityConfirmed) return fail("Confirm the account owner's identity through an established private contact first.");
  if (!input.targetUserId || input.targetUserId.length > 200 || !input.expectedEmail || input.expectedEmail.length > 320) return fail("Select an account again.");
  if (!input.operatorPassword || Buffer.byteLength(input.operatorPassword, "utf8") > 72) return fail("Enter your own current password.");
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!actor?.isPlatformAdmin || !actor.passwordHash) return fail("A platform administrator with password sign-in is required.");
  if (!(await verifyPassword(actorId, input.operatorPassword))) return fail("Your password could not be verified.");

  return prisma.$transaction(async (tx): Promise<AssistedRecoveryResult> => {
    // Deterministic lock order; role, credential, session and target changes cannot
    // race the admitted issuance. Password hashing/verification happens outside.
    const locked = await tx.$queryRaw<LockedUser[]>`
      SELECT "id", "email", "displayName", "passwordHash", "isPlatformAdmin", "sessionVersion"
      FROM "User" WHERE "id" IN (${actorId}, ${input.targetUserId}) ORDER BY "id" FOR UPDATE
    `;
    const currentActor = locked.find((u) => u.id === actorId);
    const target = locked.find((u) => u.id === input.targetUserId);
    if (!currentActor?.isPlatformAdmin || currentActor.passwordHash !== actor.passwordHash || currentActor.sessionVersion !== actor.sessionVersion) {
      return fail("Your access changed. Sign in again before creating a recovery link.");
    }
    if (!target || target.email !== input.expectedEmail) return fail("This account changed. Find the account again before continuing.");
    if (target.isPlatformAdmin || target.id === actorId) return fail("Platform administrator accounts must use their existing account recovery process.");
    if (!target.passwordHash) return fail("This account uses Google sign-in and has no password to reset.");
    const latest = await tx.passwordResetToken.findFirst({ where: { userId: target.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (latest && latest.createdAt.getTime() > Date.now() - REISSUE_INTERVAL_MS) return fail("A reset link was created recently. Wait one minute before replacing it.");
    const token = await createPasswordResetTokenInTransaction(tx, target.id, RECOVERY_TTL_MS);
    await tx.passwordRecoveryEvent.create({ data: {
      actorUserId: currentActor.id, actorName: currentActor.displayName,
      targetUserId: target.id, targetEmail: target.email, expiresAt: token.expiresAt,
    } });
    return { ok: true, rawToken: token.rawToken, expiresAt: token.expiresAt };
  });
}
