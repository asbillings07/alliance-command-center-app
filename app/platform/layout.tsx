import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { PlatformNav } from "./components/PlatformNav";
import { PlatformSearch } from "./components/PlatformSearch";
import { PlatformFooter } from "./components/PlatformFooter";
import { MobileNavWrapper } from "./components/MobileNavWrapper";

export const metadata = {
  title: "Platform Operations - Alliance Command Center",
  description: "Operational console for beta management",
};

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header with Search - Mobile & Desktop */}
      <header className="sticky top-0 z-30 bg-surface border-b border-border">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <MobileNavWrapper />
            <h1 className="text-lg font-semibold text-text-primary">
              Platform Operations
            </h1>
          </div>
          <div className="flex-1 max-w-md mx-4">
            <PlatformSearch />
          </div>
          <div className="w-8 lg:w-auto" />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex lg:w-56 lg:flex-col lg:border-r lg:border-border lg:bg-surface">
          <PlatformNav />
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <PlatformFooter />
    </div>
  );
}
