import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { getAdminAllianceWorkspaceDestination } from "@/app/src/lib/platform/adminWorkspace";
import { FeedbackWidget } from "@/app/src/components/client";
import { PlatformNav } from "./components/PlatformNav";
import { PlatformSearch } from "./components/PlatformSearch";
import { PlatformFooter } from "./components/PlatformFooter";
import { MobileNavWrapper } from "./components/MobileNavWrapper";
import { BrandLockup } from "@/app/src/components/BrandLockup";
import Link from "next/link";

export const metadata = {
  title: "Platform Operations - Alliance Command Center",
  description: "Operational console for beta management",
};

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePlatformAdmin();
  const workspace = await getAdminAllianceWorkspaceDestination(session.id);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header with Search - Mobile & Desktop */}
      <header className="sticky top-0 z-30 bg-brand-surface border-b border-border">
        <div className="brand-rule" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <MobileNavWrapper workspace={workspace} />
            <Link href="/platform/overview" aria-label="Alliance Command Center platform overview" className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <BrandLockup compact />
            </Link>
            <h1 className="border-l border-border pl-3 text-sm font-semibold text-text-secondary">
              Platform Operations
            </h1>
          </div>
          <div className="w-full sm:ml-auto sm:w-64 lg:w-80">
            <PlatformSearch />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-brand-surface">
          <PlatformNav workspace={workspace} />
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="p-4 lg:p-6">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <PlatformFooter />

      <FeedbackWidget />
    </div>
  );
}
