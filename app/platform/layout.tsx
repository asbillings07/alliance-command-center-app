import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { getAdminAllianceWorkspaceDestination } from "@/app/src/lib/platform/adminWorkspace";
import { FeedbackWidget } from "@/app/src/components/client";
import { PlatformNav } from "./components/PlatformNav";
import { PlatformSearch } from "./components/PlatformSearch";
import { PlatformFooter } from "./components/PlatformFooter";
import { MobileNavWrapper } from "./components/MobileNavWrapper";
import { BrandHeader } from "@/app/src/components/BrandHeader";

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
      <BrandHeader
        href="/platform/overview"
        actions={<><MobileNavWrapper workspace={workspace} /><h1 className="text-xs sm:text-sm font-semibold text-text-secondary">Platform Operations</h1></>}
        tools={<div className="w-full lg:w-80"><PlatformSearch /></div>}
      />

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
