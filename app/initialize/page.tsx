import { redirect } from "next/navigation";
import { isPlatformInitialized } from "@/app/src/lib/platform";
import { InitializeForm } from "./InitializeForm";

export const metadata = {
  title: "Initialize Platform - Alliance Command Center",
  description: "Create the first platform administrator",
};

/**
 * Platform Bootstrap Page
 *
 * This page is only accessible when:
 * - No platform administrators exist in the database
 *
 * After successful initialization, this page redirects to login
 * and is permanently inaccessible.
 */
export default async function InitializePage() {
  const initialized = await isPlatformInitialized();

  if (initialized) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-lg">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-text-primary mb-2">
              Welcome to Alliance Command Center
            </h1>
            <p className="text-text-muted">
              No platform administrators exist yet.
            </p>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6">
            <p className="text-sm text-primary">
              Create the first platform administrator to begin operating the platform.
              This setup runs once and cannot be repeated.
            </p>
          </div>

          <InitializeForm />
        </div>

        <p className="text-center text-xs text-text-disabled mt-4">
          Your email must be in the PLATFORM_ADMIN_EMAILS configuration.
        </p>
      </div>
    </div>
  );
}
