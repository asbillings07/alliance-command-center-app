import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import {
  validateBetaToken,
  validateBetaCode,
  type BetaValidationResult,
} from "@/app/src/lib/betaInvitation";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";
import { GoogleSignInButton } from "@/app/src/components/client";
import { AcceptBetaInvitationForm } from "./AcceptBetaInvitationForm";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ code?: string }>;
};

function ErrorIcon() {
  return (
    <div className="w-16 h-16 mx-auto mb-4 bg-danger/20 rounded-full flex items-center justify-center">
      <svg
        className="w-8 h-8 text-danger-light"
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
  );
}

function SuccessIcon() {
  return (
    <div className="w-16 h-16 mx-auto mb-4 bg-success/20 rounded-full flex items-center justify-center">
      <svg
        className="w-8 h-8 text-success-light"
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
  );
}

function ErrorCard({
  title,
  message,
  showRetry = true,
}: {
  title: string;
  message: string;
  showRetry?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8 text-center">
        <ErrorIcon />
        <h1 className="text-xl font-bold text-text-primary mb-2">{title}</h1>
        <p className="text-text-muted mb-6">{message}</p>
        {showRetry && (
          <Link href="/redeem" className="text-primary hover:text-text-primary">
            Try entering your code again
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function RedeemTokenPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const { code } = await searchParams;

  const isCodeLookup = token === "code" && code;

  const result: BetaValidationResult = isCodeLookup
    ? await validateBetaCode(code)
    : await validateBetaToken(token);

  const redeemCallbackUrl = isCodeLookup
    ? `/redeem/code?code=${encodeURIComponent(code)}`
    : `/redeem/${token}`;

  if (result.status === "not_found") {
    return (
      <ErrorCard
        title="Code Not Found"
        message="We couldn't find an invitation with this code. Please check the code and try again."
      />
    );
  }

  if (result.status === "expired") {
    return (
      <ErrorCard
        title="Invitation Expired"
        message="This beta invitation has expired. Please contact us to request a new invitation."
        showRetry={false}
      />
    );
  }

  if (result.status === "already_accepted") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8 text-center">
          <SuccessIcon />
          <h1 className="text-xl font-bold text-text-primary mb-2">
            Already Accepted
          </h1>
          <p className="text-text-muted mb-6">
            This beta invitation has already been accepted. Sign in to continue
            to your alliance.
          </p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-primary-hover text-white rounded-md hover:bg-primary-active"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (result.status === "revoked") {
    return (
      <ErrorCard
        title="Invitation Revoked"
        message="This beta invitation has been revoked. Please contact us to request a new invitation."
        showRetry={false}
      />
    );
  }

  // At this point, status is "valid" and invitation is guaranteed to exist
  const invitation = result.invitation;

  const session = await auth();
  const isLoggedIn = !!session?.user;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-primary/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-primary"
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
          <h1 className="text-xl font-bold text-text-primary mb-2">
            Welcome to the Beta!
          </h1>
          <p className="text-text-muted">
            You&apos;ve been invited to create your own alliance workspace 
            in Alliance Command Center.
          </p>
        </div>

        <div className="bg-surface-secondary rounded-lg p-4 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Invited Email</span>
            <span className="font-medium text-text-primary">
              {invitation.email}
            </span>
          </div>
        </div>

        {isLoggedIn ? (
          <AcceptBetaInvitationForm invitationId={invitation.id} />
        ) : (
          <div className="space-y-4">
            {isGoogleAuthEnabled() && (
              <>
                <GoogleSignInButton
                  callbackUrl={redeemCallbackUrl}
                  className="flex w-full items-center justify-center px-4 py-2 bg-primary-hover text-white rounded-md hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                />
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-wide text-text-muted">
                    or
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(redeemCallbackUrl)}`}
              className="block w-full px-4 py-2 bg-primary-hover text-white text-center rounded-md hover:bg-primary-active"
            >
              Create Account
            </Link>
            <p className="text-center text-sm text-text-muted">
              After creating your account, you&apos;ll set up your alliance.
            </p>
            <p className="text-center text-sm text-text-muted">
              Already have an account?{" "}
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(redeemCallbackUrl)}`}
                className="text-primary hover:text-text-primary"
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
