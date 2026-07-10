import Link from "next/link";
import { prisma } from "@/app/src/lib/prisma";
import {
  validateBetaToken,
  validateBetaCode,
} from "@/app/src/lib/betaInvitation";
import { RegisterForm } from "./RegisterForm";

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
      <main className="flex items-center justify-center min-h-screen bg-[#0F172A]">
        <section className="flex flex-col gap-4 p-6 bg-[#111827] border border-[#374151] rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold text-center text-[#F9FAFB]">
            Create Account
          </h1>
          <p className="text-center text-[#9CA3AF] text-sm">
            Create your account to continue with your beta invitation.
          </p>

          <RegisterForm callbackUrl={callbackUrl} email={betaInvitation.email} darkMode />

          <div className="text-center pt-2 border-t border-[#374151]">
            <p className="text-sm text-[#9CA3AF]">
              Already have an account?{" "}
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="text-[#3B82F6] hover:text-[#60A5FA]"
              >
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </main>
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
    where: isCodeLookup && codeMatch
      ? { code: decodeURIComponent(codeMatch[1]) }
      : { token },
  });

  if (!invitation) {
    return <InvitationRequired message="Invalid invitation link" />;
  }

  if (invitation.acceptedAt) {
    return <InvitationRequired message="This invitation has already been accepted" />;
  }

  if (invitation.cancelledAt) {
    return <InvitationRequired message="This invitation has been cancelled" />;
  }

  if (invitation.expiresAt < new Date()) {
    return <InvitationRequired message="This invitation has expired" />;
  }

  return (
    <main className="flex items-center justify-center min-h-screen">
      <section className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-md max-w-md w-full">
        <h1 className="text-2xl font-bold text-center text-gray-800">
          Create Account
        </h1>

        <RegisterForm
          callbackUrl={callbackUrl}
          displayName={invitation.playerNameSnapshot}
        />

        <div className="text-center pt-2 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="text-blue-500 hover:text-blue-700"
            >
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function InvitationRequired({ message }: { message?: string }) {
  return (
    <main className="flex items-center justify-center min-h-screen bg-[#0F172A]">
      <section className="flex flex-col gap-4 p-6 bg-[#111827] border border-[#374151] rounded-lg shadow-md max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-[#F9FAFB]">
          Invitation Required
        </h1>
        <p className="text-[#9CA3AF]">
          {message || "Registration is currently by invitation only."}
        </p>
        <div className="pt-4 space-y-3">
          <Link
            href="/redeem"
            className="block w-full px-4 py-2 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB]"
          >
            Have a Beta Code?
          </Link>
          <Link
            href="/invite"
            className="block w-full px-4 py-2 border border-[#374151] text-[#F9FAFB] rounded-md hover:border-[#3B82F6]"
          >
            Have an Alliance Invitation?
          </Link>
          <Link
            href="/login"
            className="block w-full px-4 py-2 text-[#9CA3AF] hover:text-[#F9FAFB]"
          >
            Back to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
