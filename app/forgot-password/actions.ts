"use server";

import { prisma } from "@/app/src/lib/prisma";
import { createPasswordResetToken } from "@/app/src/lib/passwordReset";
import { emailService } from "@/app/src/lib/email";
import { getResetPasswordUrl } from "@/app/src/lib/appUrl";

export type ForgotPasswordState = {
  submitted: boolean;
  error: string | null;
};

/**
 * Request a password reset link.
 *
 * Anti-enumeration: this always resolves to the same generic "submitted" state
 * regardless of whether the email exists, whether the account is Google-only,
 * or whether email delivery succeeded. A reset link is created and emailed only
 * for accounts that actually have a password; everything else silently falls
 * through so the response can't be used to probe which emails are registered.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email")?.toString().trim().toLowerCase();

  if (!email) {
    return { submitted: false, error: "Email is required" };
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Only password-capable accounts can reset. Google-only users have no
    // passwordHash; unknown emails have no user. Both paths do nothing here.
    if (user?.passwordHash) {
      const { rawToken, expiresAt } = await createPasswordResetToken(user.id);
      await emailService.sendPasswordReset({
        to: user.email,
        reset: { resetUrl: getResetPasswordUrl(rawToken), expiresAt },
        userId: user.id,
      });
    }
  } catch (error) {
    // Never surface failures to the client: a DB/provider hiccup must not
    // reveal account existence. Log for operators instead.
    console.error("[password-reset] requestPasswordReset failed", error);
  }

  return { submitted: true, error: null };
}
