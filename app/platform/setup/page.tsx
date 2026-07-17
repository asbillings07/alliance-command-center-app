import Link from "next/link";
import { Badge } from "@/app/src/components";
import {
  getAllianceReadiness,
  getSetupFunnel,
  type AllianceReadinessItem,
} from "@/app/src/lib/platform";

/**
 * Platform Setup
 *
 * Answers: "Which alliances are onboarding?"
 *
 * Sections:
 * 1. Setup Summary
 * 2. Alliance Readiness (with filters)
 * 3. Stalled Alliances
 * 4. New Alliances
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

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-2 bg-border rounded-full overflow-hidden">
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function AllianceCard({ alliance }: { alliance: AllianceReadinessItem }) {
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
      className="block bg-surface rounded-lg border border-border p-4 hover:border-border-hover transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-text-primary">{alliance.name}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Last active: {formatTimeAgo(alliance.lastActivity)}
          </p>
        </div>
        <Badge variant={config.variant} size="sm">
          {config.label}
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Progress</span>
          <span>{alliance.progress}%</span>
        </div>
        <ProgressBar progress={alliance.progress} />

        <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
          <div
            className={`text-center py-1 rounded ${alliance.hasMetrics ? "bg-success/20 text-success" : "bg-border text-text-disabled"}`}
          >
            Metrics
          </div>
          <div
            className={`text-center py-1 rounded ${alliance.hasPeriods ? "bg-success/20 text-success" : "bg-border text-text-disabled"}`}
          >
            Periods
          </div>
          <div
            className={`text-center py-1 rounded ${alliance.hasMembers ? "bg-success/20 text-success" : "bg-border text-text-disabled"}`}
          >
            Members
          </div>
          <div
            className={`text-center py-1 rounded ${alliance.hasData ? "bg-success/20 text-success" : "bg-border text-text-disabled"}`}
          >
            Data
          </div>
        </div>
      </div>
    </Link>
  );
}

function AllianceTable({ alliances }: { alliances: AllianceReadinessItem[] }) {
  const statusConfig = {
    ready: { variant: "success" as const, label: "Ready" },
    needsSetup: { variant: "warning" as const, label: "Needs Setup" },
    new: { variant: "info" as const, label: "New" },
    stalled: { variant: "danger" as const, label: "Stalled" },
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Alliance
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Progress
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Status
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Last Activity
            </th>
            <th className="text-center py-3 px-2 text-text-muted font-medium">
              M
            </th>
            <th className="text-center py-3 px-2 text-text-muted font-medium">
              P
            </th>
            <th className="text-center py-3 px-2 text-text-muted font-medium">
              Mem
            </th>
            <th className="text-center py-3 px-2 text-text-muted font-medium">
              D
            </th>
          </tr>
        </thead>
        <tbody>
          {alliances.map((alliance) => {
            const config = statusConfig[alliance.status];
            return (
              <tr
                key={alliance.id}
                className="border-b border-border hover:bg-surface-secondary transition-colors"
              >
                <td className="py-3 px-4">
                  <Link
                    href={`/platform/support/alliance/${alliance.id}`}
                    className="text-text-primary hover:text-primary font-medium"
                  >
                    {alliance.name}
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16">
                      <ProgressBar progress={alliance.progress} />
                    </div>
                    <span className="text-text-muted text-xs">
                      {alliance.progress}%
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <Badge variant={config.variant} size="sm">
                    {config.label}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-text-muted">
                  {formatTimeAgo(alliance.lastActivity)}
                </td>
                <td className="py-3 px-2 text-center">
                  {alliance.hasMetrics ? (
                    <span className="text-success">✓</span>
                  ) : (
                    <span className="text-text-disabled">–</span>
                  )}
                </td>
                <td className="py-3 px-2 text-center">
                  {alliance.hasPeriods ? (
                    <span className="text-success">✓</span>
                  ) : (
                    <span className="text-text-disabled">–</span>
                  )}
                </td>
                <td className="py-3 px-2 text-center">
                  {alliance.hasMembers ? (
                    <span className="text-success">✓</span>
                  ) : (
                    <span className="text-text-disabled">–</span>
                  )}
                </td>
                <td className="py-3 px-2 text-center">
                  {alliance.hasData ? (
                    <span className="text-success">✓</span>
                  ) : (
                    <span className="text-text-disabled">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlatformSetup() {
  const [alliances, funnel] = await Promise.all([
    getAllianceReadiness(),
    getSetupFunnel(),
  ]);

  const stalledAlliances = alliances.filter((a) => a.status === "stalled");
  const newAlliances = alliances.filter((a) => a.status === "new");
  const needsSetupAlliances = alliances.filter((a) => a.status === "needsSetup");
  const readyAlliances = alliances.filter((a) => a.status === "ready");

  const summary = {
    ready: readyAlliances.length,
    needsSetup: needsSetupAlliances.length,
    stalled: stalledAlliances.length,
    new: newAlliances.length,
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Setup Summary */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Setup Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-success/10 rounded-lg p-4 border border-success/20">
            <div className="text-2xl font-bold text-success">{summary.ready}</div>
            <div className="text-sm text-success/80">Ready</div>
          </div>
          <div className="bg-warning/10 rounded-lg p-4 border border-warning/20">
            <div className="text-2xl font-bold text-warning">
              {summary.needsSetup}
            </div>
            <div className="text-sm text-warning/80">Needs Setup</div>
          </div>
          <div className="bg-danger/10 rounded-lg p-4 border border-danger/20">
            <div className="text-2xl font-bold text-danger">
              {summary.stalled}
            </div>
            <div className="text-sm text-danger/80">Stalled</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
            <div className="text-2xl font-bold text-primary">{summary.new}</div>
            <div className="text-sm text-primary/80">New</div>
          </div>
        </div>
      </section>

      {/* Stalled Alliances - Priority */}
      {stalledAlliances.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Stalled Alliances
            <span className="ml-2 text-sm font-normal text-danger">
              ({stalledAlliances.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {stalledAlliances.map((alliance) => (
              <AllianceCard key={alliance.id} alliance={alliance} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <AllianceTable alliances={stalledAlliances} />
          </div>
        </section>
      )}

      {/* Needs Setup */}
      {needsSetupAlliances.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Needs Setup
            <span className="ml-2 text-sm font-normal text-warning">
              ({needsSetupAlliances.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {needsSetupAlliances.map((alliance) => (
              <AllianceCard key={alliance.id} alliance={alliance} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <AllianceTable alliances={needsSetupAlliances} />
          </div>
        </section>
      )}

      {/* New Alliances */}
      {newAlliances.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            New This Week
            <span className="ml-2 text-sm font-normal text-primary">
              ({newAlliances.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {newAlliances.map((alliance) => (
              <AllianceCard key={alliance.id} alliance={alliance} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <AllianceTable alliances={newAlliances} />
          </div>
        </section>
      )}

      {/* Ready Alliances */}
      {readyAlliances.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Ready
            <span className="ml-2 text-sm font-normal text-success">
              ({readyAlliances.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {readyAlliances.map((alliance) => (
              <AllianceCard key={alliance.id} alliance={alliance} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <AllianceTable alliances={readyAlliances} />
          </div>
        </section>
      )}

      {/* Empty State */}
      {alliances.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <p>No alliances yet.</p>
          <p className="text-sm mt-1">
            Invite beta users to get started.
          </p>
        </div>
      )}
    </div>
  );
}
