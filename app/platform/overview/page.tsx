import Link from "next/link";
import { Badge } from "@/app/src/components";
import {
  getAllianceHealth,
  getAllianceReadiness,
  getActionRequiredBySeverity,
  getSetupFunnel,
  getRecentActivity,
  type ActionRequiredItem,
  type Severity,
} from "@/app/src/lib/platform";

/**
 * Platform Overview
 *
 * Landing page. Answers: "What is happening?"
 *
 * Sections:
 * 1. Action Required (always first, grouped by severity)
 * 2. Beta Health (stats)
 * 3. Setup Funnel
 * 4. Live Feed
 */

// Severity badge mapping
const severityConfig: Record<
  Severity,
  { icon: string; variant: "danger" | "warning" | "info"; label: string }
> = {
  critical: { icon: "🔴", variant: "danger", label: "Critical" },
  warning: { icon: "🟡", variant: "warning", label: "Warning" },
  info: { icon: "🔵", variant: "info", label: "Info" },
};

function ActionRequiredSection({
  items,
  severity,
}: {
  items: ActionRequiredItem[];
  severity: Severity;
}) {
  if (items.length === 0) return null;

  const config = severityConfig[severity];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
        <span>{config.icon}</span>
        <span>
          {config.label} ({items.length})
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="block px-3 py-2 bg-surface-secondary rounded-lg border border-border hover:border-border-hover transition-colors"
          >
            <div className="text-sm text-text-primary">{item.title}</div>
            <div className="text-xs text-text-muted mt-0.5">
              {item.description}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: number | string;
  subtext?: string;
}) {
  return (
    <div className="bg-surface-secondary rounded-lg p-4 border border-border">
      <div className="text-text-muted text-sm">{label}</div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      {subtext && (
        <div className="text-xs text-text-disabled mt-1">{subtext}</div>
      )}
    </div>
  );
}

function FunnelBar({
  label,
  count,
  percentage,
}: {
  label: string;
  count: number;
  percentage: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-sm text-text-secondary text-right truncate">
        {label}
      </div>
      <div className="flex-1 h-5 bg-border rounded overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="w-10 text-sm text-text-primary font-mono text-right">
        {count}
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
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

export default async function PlatformOverview() {
  const [health, readiness, actionRequired, funnel, activity] =
    await Promise.all([
      getAllianceHealth(),
      getAllianceReadiness(),
      getActionRequiredBySeverity(),
      getSetupFunnel(),
      getRecentActivity({ limit: 10 }),
    ]);

  // Calculate readiness summary
  const readySummary = {
    ready: readiness.filter((a) => a.status === "ready").length,
    needsSetup: readiness.filter((a) => a.status === "needsSetup").length,
    new: readiness.filter((a) => a.status === "new").length,
    stalled: readiness.filter((a) => a.status === "stalled").length,
  };

  const hasCritical = actionRequired.critical.length > 0;
  const hasWarning = actionRequired.warning.length > 0;
  const hasInfo = actionRequired.info.length > 0;
  const hasActionRequired = hasCritical || hasWarning || hasInfo;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Section 1: Action Required */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Action Required
        </h2>
        <div className="bg-surface rounded-lg border border-border p-4">
          {!hasActionRequired ? (
            <div className="flex items-center gap-2 text-text-muted">
              <svg
                className="w-5 h-5 text-success"
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
              <span>No items require attention</span>
            </div>
          ) : (
            <div className="space-y-4">
              <ActionRequiredSection
                items={actionRequired.critical}
                severity="critical"
              />
              <ActionRequiredSection
                items={actionRequired.warning}
                severity="warning"
              />
              <ActionRequiredSection
                items={actionRequired.info}
                severity="info"
              />
            </div>
          )}
        </div>
      </section>

      {/* Section 2: Beta Health */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Beta Health
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Alliances" value={health.total} />
          <StatCard
            label="Active Today"
            value={health.activeToday}
            subtext="activity in last 24h"
          />
          <StatCard label="New This Week" value={health.newThisWeek} />
          <StatCard
            label="Ready"
            value={readySummary.ready}
            subtext={`${readySummary.needsSetup} need setup`}
          />
        </div>
      </section>

      {/* Section 3: Alliance Readiness (compact) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-secondary">
            Alliance Readiness
          </h2>
          <Link
            href="/platform/setup"
            className="text-sm text-primary hover:text-primary-hover"
          >
            View all →
          </Link>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex items-center justify-between px-3 py-2 rounded bg-success/10 text-success">
              <span className="text-sm">Ready</span>
              <span className="font-mono font-medium">{readySummary.ready}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 rounded bg-warning/10 text-warning">
              <span className="text-sm">Needs Setup</span>
              <span className="font-mono font-medium">
                {readySummary.needsSetup}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 rounded bg-danger/10 text-danger">
              <span className="text-sm">Stalled</span>
              <span className="font-mono font-medium">
                {readySummary.stalled}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 rounded bg-text-muted/10 text-text-muted">
              <span className="text-sm">New</span>
              <span className="font-mono font-medium">{readySummary.new}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Setup Funnel */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-secondary">
            Setup Funnel
          </h2>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="space-y-2">
            {funnel.stages.map((stage) => (
              <FunnelBar
                key={stage.label}
                label={stage.label}
                count={stage.count}
                percentage={stage.percentage}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Section 5: Live Feed */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-secondary">
            Live Feed
          </h2>
          <Link
            href="/platform/activity"
            className="text-sm text-primary hover:text-primary-hover"
          >
            View all →
          </Link>
        </div>
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          {activity.length === 0 ? (
            <div className="p-4 text-text-muted text-sm">No recent activity</div>
          ) : (
            <div className="divide-y divide-border">
              {activity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href || "#"}
                  className="flex items-center justify-between px-4 py-3 hover:bg-surface-secondary transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-text-disabled font-mono w-12">
                      {item.timestamp.toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    <span className="text-text-primary font-medium truncate">
                      {item.allianceName}
                    </span>
                    <span className="text-text-muted text-sm truncate">
                      {item.description}
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {formatTimeAgo(item.timestamp)}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
