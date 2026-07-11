import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/app/src/components";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full px-4">
        <div className="text-center mb-10">
          <div className="w-20 h-20 mx-auto mb-6 bg-primary/20 rounded-full flex items-center justify-center">
            <svg
              className="w-10 h-10 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-primary mb-3">
            Alliance Command Center
          </h1>
          <p className="text-text-secondary text-lg">
            Leadership tools for Last War alliances.
          </p>
        </div>

        <div className="space-y-4">
          <Button href="/login" variant="primary" fullWidth size="lg">
            Sign In
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-text-muted">
                Have a beta code?
              </span>
            </div>
          </div>

          <Button href="/redeem" variant="secondary" fullWidth size="lg">
            Redeem Invitation
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-text-muted">
                Want access?
              </span>
            </div>
          </div>

          <Link
            href="/request-access"
            className="block w-full px-4 py-3 bg-surface-secondary text-text-secondary text-center font-medium rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
          >
            Request Beta Access
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-text-muted">
          Alliance Command Center is currently in private beta.
        </p>
      </div>
    </div>
  );
}
