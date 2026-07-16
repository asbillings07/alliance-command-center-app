import Link from "next/link";
import { Badge } from "@/app/src/components";
import {
  getAllianceReadiness,
  getActionRequiredBySeverity,
  type AllianceReadinessItem,
} from "@/app/src/lib/platform";

/**
 * Platform Support
 *
 * Answers: "Help someone."
 *
 * Features:
 * - Alliance lookup (search is in layout header)
 * - Quick access to alliances needing attention
 * - Jump links
 */

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function AllianceQuickCard({ alliance }: { alliance: AllianceReadinessItem }) {
  const statusConfig = {
    ready: { variant: "success" as const, label: "Ready" },
    needsSetup: { variant: "warning" as const, label: "Needs Setup" },
    new: { variant: "info" as const, label: "New" },
    stalled: { variant: "danger" as const, label: "Stalled" },
  };

  const config = statusConfig[alliance.status];

  return (
    <Link
      href={`/platform/support/alliance/${alliance.id}`}
      className="block bg-surface-secondary rounded-lg border border-border p-4 hover:border-border-hover transition-colors"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-text-primary">{alliance.name}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {formatTimeAgo(alliance.lastActivity)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{alliance.progress}%</span>
          <Badge variant={config.variant} size="sm">
            {config.label}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

export default async function PlatformSupport() {
  const [alliances, actionRequired] = await Promise.all([
    getAllianceReadiness(),
    getActionRequiredBySeverity(),
  ]);

  // Sort alliances by status priority: stalled, needsSetup, new, ready
  const statusPriority = { stalled: 0, needsSetup: 1, new: 2, ready: 3 };
  const sortedAlliances = [...alliances].sort(
    (a, b) => statusPriority[a.status] - statusPriority[b.status]
  );

  const needsHelpCount =
    actionRequired.critical.length + actionRequired.warning.length;

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Search Hint */}
      <section className="bg-surface-secondary rounded-lg border border-border p-4">
        <p className="text-text-muted text-sm">
          Use the search bar above to find alliances, users, or members by name
          or email.
        </p>
      </section>

      {/* Needs Help */}
      {needsHelpCount > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Needs Help
            <span className="ml-2 text-sm font-normal text-danger">
              ({needsHelpCount})
            </span>
          </h2>
          <div className="space-y-2">
            {actionRequired.critical.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block bg-danger/10 rounded-lg border border-danger/20 p-3 hover:border-danger/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-danger">🔴</span>
                  <span className="text-text-primary font-medium">
                    {item.title}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-1 ml-6">
                  {item.description}
                </p>
              </Link>
            ))}
            {actionRequired.warning.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block bg-warning/10 rounded-lg border border-warning/20 p-3 hover:border-warning/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-warning">🟡</span>
                  <span className="text-text-primary font-medium">
                    {item.title}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-1 ml-6">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* All Alliances */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          All Alliances
          <span className="ml-2 text-sm font-normal text-text-muted">
            ({alliances.length})
          </span>
        </h2>
        {alliances.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            No alliances yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedAlliances.map((alliance) => (
              <AllianceQuickCard key={alliance.id} alliance={alliance} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
