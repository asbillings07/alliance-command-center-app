import { prisma } from "@/app/src/lib/prisma";
import { getPendingInvitation } from "@/app/src/lib/betaInvitation";
import { normalizeEmail } from "@/app/src/lib/email/normalize";

/**
 * Account eligibility (business policy layer).
 *
 * This module answers: "Is this email allowed to create an account on the
 * platform?" It is provider-agnostic (reusable by any future OAuth provider)
 * and deliberately independent of authentication/profile parsing.
 *
 * Eligibility is governed entirely by the invitation model: an email may join
 * if it has a pending beta invitation OR a pending alliance invitation.
 */
export async function isInvitationEligible(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);

  const pendingBeta = await getPendingInvitation(normalizedEmail);
  if (pendingBeta) {
    return true;
  }

  const pendingAllianceInvite = await prisma.invitation.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: "insensitive" },
      acceptedAt: null,
      cancelledAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  return Boolean(pendingAllianceInvite);
}
