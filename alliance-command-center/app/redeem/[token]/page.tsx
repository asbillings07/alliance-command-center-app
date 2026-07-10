import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import { validateBetaToken } from "@/app/src/lib/betaInvitation";
import { AcceptBetaInvitationForm } from "./AcceptBetaInvitationForm";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function RedeemTokenPage({ params }: PageProps) {
  const { token } = await params;

  const invitation = await validateBetaToken(token);

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
            This invitation link is invalid or has expired.
          </p>
          <Link href="/redeem" className="text-[#3B82F6] hover:text-[#60A5FA]">
            Try entering your code again
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
            This beta invitation has already been accepted.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-[#3B82F6] text-white rounded-md hover:bg-[#2563EB]"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const session = await auth();
  const isLoggedIn = !!session?.user;

  const redeemCallbackUrl = `/redeem/${token}`;

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
                d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#F9FAFB] mb-2">
            Welcome to Alliance Command Center
          </h1>
          <p className="text-[#9CA3AF]">
            You&apos;ve been invited to the beta. Accept this invitation to
            create your alliance workspace.
          </p>
        </div>

        <div className="bg-[#1F2937] rounded-lg p-4 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-[#9CA3AF]">Invited Email</span>
            <span className="font-medium text-[#F9FAFB]">
              {invitation.email}
            </span>
          </div>
        </div>

        {isLoggedIn ? (
          <AcceptBetaInvitationForm invitationId={invitation.id} />
        ) : (
          <div className="space-y-4">
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(redeemCallbackUrl)}`}
              className="block w-full px-4 py-2 bg-[#3B82F6] text-white text-center rounded-md hover:bg-[#2563EB]"
            >
              Create Account to Continue
            </Link>
            <p className="text-center text-sm text-[#9CA3AF]">
              Already have an account?{" "}
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(redeemCallbackUrl)}`}
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
