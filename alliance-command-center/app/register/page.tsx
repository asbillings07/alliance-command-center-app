import Link from "next/link";
import { prisma } from "@/app/src/lib/prisma";
import { RegisterForm } from "./RegisterForm";

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string; name?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const { callbackUrl = "" } = await searchParams;

  // Extract invitation token from callbackUrl
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
    <main className="flex items-center justify-center min-h-screen">
      <section className="flex flex-col gap-4 p-6 bg-white rounded-lg shadow-md max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-gray-800">
          Invitation Required
        </h1>
        <p className="text-gray-600">
          {message || "Registration is currently by invitation only. Please ask your alliance leader for an invitation link or code."}
        </p>
        <div className="pt-4 space-y-3">
          <Link
            href="/invite"
            className="block w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Enter Invitation Code
          </Link>
          <Link
            href="/login"
            className="block w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
          >
            Back to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
