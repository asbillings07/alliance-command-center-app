import Link from "next/link";
import { prisma } from "@/app/src/lib/prisma";
import {
  validateBetaToken,
  validateBetaCode,
} from "@/app/src/lib/betaInvitation";
import { RegisterForm } from "./RegisterForm";
import { AuthLayout, Button } from "@/app/src/components";

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string; name?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const { callbackUrl = "" } = await searchParams;

  // Check for beta invitation from /redeem/[token] or /redeem/code?code=XXX
  const redeemMatch = callbackUrl.match(/\/redeem\/([^/?]+)/);
  if (redeemMatch) {
    const betaTokenOrCode = redeemMatch[1];
    const isCodeLookup = betaTokenOrCode === "code";
    const codeMatch = callbackUrl.match(/[?&]code=([^&]+)/);
    const decodedCode =
      isCodeLookup && codeMatch
        ? (() => {
            try {
              return decodeURIComponent(codeMatch[1]);
            } catch {
              return codeMatch[1];
            }
          })()
        : null;

    const result =
      isCodeLookup && decodedCode
        ? await validateBetaCode(decodedCode)
        : await validateBetaToken(betaTokenOrCode);

    if (result.status === "not_found") {
      return (
        <InvitationRequired message="We couldn't find an invitation with this code. Please check the code and try again." />
      );
    }

    if (result.status === "expired") {
      return (
        <InvitationRequired message="This beta invitation has expired. Please contact us to request a new invitation." />
      );
    }

    if (result.status === "already_accepted") {
      return (
        <InvitationRequired message="This beta invitation has already been accepted. Please sign in instead." />
      );
    }

    const betaInvitation = result.invitation;

    return (
      <AuthLayout
        title="Create Account"
        subtitle="Create your account to continue with your beta invitation."
        footer={
          <p>
            Already have an account?{" "}
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="text-primary hover:text-primary-hover underline"
            >
              Sign in
            </Link>
          </p>
        }
      >
        <RegisterForm callbackUrl={callbackUrl} email={betaInvitation.email} />
      </AuthLayout>
    );
  }

  // Check for alliance invitation from /invite/[token]
  const tokenMatch = callbackUrl.match(/\/invite\/([^/?]+)/);

  if (!tokenMatch) {
    return <InvitationRequired />;
  }

  const token = tokenMatch[1];

  // Handle code-based lookup
  const isCodeLookup = token === "code";
  const codeMatch = callbackUrl.match(/[?&]code=([^&]+)/);

  const invitation = await prisma.invitation.findFirst({
    where:
      isCodeLookup && codeMatch
        ? { code: decodeURIComponent(codeMatch[1]) }
        : { token },
  });

  if (!invitation) {
    return <InvitationRequired message="Invalid invitation link" />;
  }

  if (invitation.acceptedAt) {
    return (
      <InvitationRequired message="This invitation has already been accepted" />
    );
  }

  if (invitation.cancelledAt) {
    return <InvitationRequired message="This invitation has been cancelled" />;
  }

  if (invitation.expiresAt < new Date()) {
    return <InvitationRequired message="This invitation has expired" />;
  }

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Create your account to join the alliance."
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="text-primary hover:text-primary-hover underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterForm
        callbackUrl={callbackUrl}
        displayName={invitation.playerNameSnapshot}
      />
    </AuthLayout>
  );
}

function InvitationRequired({ message }: { message?: string }) {
  return (
    <AuthLayout
      title="Invitation Required"
      subtitle={message || "Registration is currently by invitation only."}
    >
      <div className="space-y-3">
        <Button variant="primary" fullWidth href="/redeem">
          Have a Beta Code?
        </Button>
        <Button variant="secondary" fullWidth href="/invite">
          Have an Alliance Invitation?
        </Button>
        <Button variant="ghost" fullWidth href="/login">
          Back to Login
        </Button>
      </div>
    </AuthLayout>
  );
}
