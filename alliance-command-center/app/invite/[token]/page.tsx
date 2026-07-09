import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { AcceptInvitationForm } from "./AcceptInvitationForm";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ code?: string }>;
};

export default async function InvitePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { code } = await searchParams;

  const lookupToken = token === "code" && code ? null : token;
  const lookupCode = token === "code" ? code : null;
  
  // Build the callback URL - preserve the code query param if using code lookup
  const inviteCallbackUrl = lookupCode 
    ? `/invite/code?code=${encodeURIComponent(lookupCode)}`
    : `/invite/${token}`;

  const invitation = await prisma.invitation.findFirst({
    where: lookupToken
      ? { token: lookupToken }
      : { code: lookupCode ?? undefined },
    include: {
      alliance: {
        select: { id: true, name: true },
      },
      invitedBy: {
        select: { displayName: true },
      },
      allianceMember: {
        select: { id: true, playerName: true },
      },
    },
  });

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#EF4444]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#EF4444]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Invalid Invitation
          </h1>
          <p className="text-[#9CA3AF] mb-6">
            This invitation link is invalid or has been revoked.
          </p>
          <Link
            href="/login"
            className="text-[#3B82F6] hover:text-[#60A5FA]"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.cancelledAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#F59E0B]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#F59E0B]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Invitation Cancelled
          </h1>
          <p className="text-[#9CA3AF] mb-6">
            This invitation has been cancelled by the alliance administrator.
          </p>
          <Link
            href="/login"
            className="text-[#3B82F6] hover:text-[#60A5FA]"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.expiresAt < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#F59E0B]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#F59E0B]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Invitation Expired
          </h1>
          <p className="text-[#9CA3AF] mb-6">
            This invitation has expired. Please ask the alliance administrator to
            resend the invitation.
          </p>
          <Link
            href="/login"
            className="text-[#3B82F6] hover:text-[#60A5FA]"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.acceptedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#22C55E]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#22C55E]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Already Accepted
          </h1>
          <p className="text-[#9CA3AF] mb-6">
            This invitation has already been accepted.
          </p>
          <Link
            href={`/alliances/${invitation.allianceId}`}
            className="text-[#3B82F6] hover:text-[#60A5FA]"
          >
            Go to {invitation.alliance.name}
          </Link>
        </div>
      </div>
    );
  }

  const session = await auth();
  const isLoggedIn = !!session?.user;

  // Check if logged-in user already has access
  let alreadyHasAccess = false;
  if (session?.user?.id) {
    const existingMembership = await prisma.allianceMembership.findUnique({
      where: {
        allianceId_userId: {
          allianceId: invitation.allianceId,
          userId: session.user.id,
        },
      },
    });
    alreadyHasAccess = !!existingMembership;
  }

  if (alreadyHasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#3B82F6]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#3B82F6]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            You Already Have Access
          </h1>
          <p className="text-[#9CA3AF] mb-6">
            You&apos;re already a member of <strong className="text-[#F9FAFB]">{invitation.alliance.name}</strong>. 
            No need to accept this invitation.
          </p>
          <Link
            href={`/alliances/${invitation.allianceId}`}
            className="inline-block px-4 py-2 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB]"
          >
            Go to {invitation.alliance.name}
          </Link>
        </div>
      </div>
    );
  }

  function formatRole(role: string): string {
    switch (role) {
      case "ADMIN":
        return "Admin";
      case "LEADER":
        return "Leader";
      case "VIEWER":
        return "Viewer";
      default:
        return role;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
      <div className="max-w-md w-full bg-[#111827] border border-[#374151] rounded-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#3B82F6]/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#3B82F6]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            You&apos;re Invited!
          </h1>
          <p className="text-[#9CA3AF]">
            {invitation.invitedBy.displayName} has invited you to join the
            leadership team of <strong className="text-[#F9FAFB]">{invitation.alliance.name}</strong>.
          </p>
        </div>

        <div className="bg-[#1F2937] rounded-lg p-4 mb-6 space-y-2">
          {invitation.allianceMember && (
            <div className="flex justify-between text-sm">
              <span className="text-[#9CA3AF]">Player Name</span>
              <span className="font-medium text-[#F9FAFB]">
                {invitation.allianceMember.playerName}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-[#9CA3AF]">Role</span>
            <span className="font-medium text-[#F9FAFB]">
              {formatRole(invitation.membershipRole)}
            </span>
          </div>
        </div>

        {isLoggedIn ? (
          <AcceptInvitationForm
            invitationId={invitation.id}
            allianceId={invitation.allianceId}
            allianceName={invitation.alliance.name}
          />
        ) : (
          <div className="space-y-4">
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(inviteCallbackUrl)}`}
              className="block w-full px-4 py-2 bg-[#3B82F6] text-white text-center rounded-md hover:bg-[#2563EB]"
            >
              Create Account to Join
            </Link>
            <p className="text-center text-sm text-[#9CA3AF]">
              Already have an account?{" "}
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(inviteCallbackUrl)}`}
                className="text-[#3B82F6] hover:text-[#60A5FA]"
              >
                Sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
