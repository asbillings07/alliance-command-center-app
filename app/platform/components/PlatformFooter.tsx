/**
 * Platform Footer
 *
 * Operational context for running a beta.
 * Small, not flashy - but useful.
 */

// In a real app, these would come from build/runtime config
const APP_VERSION = "0.8.3";
const ENVIRONMENT = "Beta";

export function PlatformFooter() {
  return (
    <footer className="border-t border-border bg-surface px-4 py-2">
      <div className="flex items-center justify-center gap-3 text-xs text-text-disabled">
        <span>ACC v{APP_VERSION}</span>
        <span className="text-border">•</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          DB Connected
        </span>
        <span className="text-border">•</span>
        <span>{ENVIRONMENT}</span>
      </div>
    </footer>
  );
}
