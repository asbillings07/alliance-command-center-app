import { getBetaStats, type NeedsAttentionItem } from "@/app/src/lib/betaDashboard";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { PageLayout, Card, Badge, EmptyState } from "@/app/src/components";

/**
 * StatCard - Displays a single metric
 */
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
      {subtext && <div className="text-xs text-text-disabled mt-1">{subtext}</div>}
    </div>
  );
}

/**
 * FunnelBar - Displays a single funnel stage
 */
function FunnelBar({
  label,
  count,
  maxCount,
}: {
  label: string;
  count: number;
  maxCount: number;
}) {
  const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-40 text-sm text-text-secondary text-right">{label}</div>
      <div className="flex-1 h-6 bg-border rounded overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="w-12 text-sm text-text-primary font-mono">{count}</div>
    </div>
  );
}

/**
 * ReadinessIndicator - Shows alliance readiness status
 */
function ReadinessIndicator({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: "success" | "warning" | "neutral";
}) {
  const variantClasses = {
    success: "bg-success/20 text-success",
    warning: "bg-warning/20 text-warning",
    neutral: "bg-text-muted/20 text-text-muted",
  };

  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded ${variantClasses[variant]}`}
    >
      <span className="text-sm">{label}</span>
      <span className="font-mono font-medium">{count}</span>
    </div>
  );
}

/**
 * NeedsAttentionList - Shows items needing attention
 */
function NeedsAttentionList({ items }: { items: NeedsAttentionItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CheckIcon />}
        title="No items need attention"
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={`${item.type}-${item.id}`}
          className="flex items-center justify-between px-3 py-2 bg-surface-secondary rounded border border-border"
        >
          <div>
            <div className="text-sm text-text-primary">{item.label}</div>
            <div className="text-xs text-text-disabled">{item.detail}</div>
          </div>
          {item.type === "stuck_alliance" && item.daysSinceActivity && (
            <Badge variant="warning" size="sm">
              {item.daysSinceActivity}d
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
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

export default async function PlatformDashboard() {
  await requirePlatformAdmin();

  const stats = await getBetaStats();
  const maxFunnelCount = Math.max(...stats.funnel.map((s) => s.count), 1);

  return (
    <PageLayout
      title="Platform Dashboard"
      description="Operational visibility into beta progress"
      maxWidth="6xl"
    >
      {/* Top Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Alliances Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text-secondary">Alliances</h2>
          <div className="space-y-3">
            <StatCard label="Total Alliances" value={stats.alliances.total} />
            <StatCard
              label="Active Today"
              value={stats.alliances.activeToday}
              subtext="with activity in last 24h"
            />
            <StatCard label="New This Week" value={stats.alliances.newThisWeek} />
          </div>
        </section>

        {/* Users Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text-secondary">Users</h2>
          <div className="space-y-3">
            <StatCard label="Total Users" value={stats.users.total} />
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Owners" value={stats.users.owners} />
              <StatCard label="Admins" value={stats.users.admins} />
              <StatCard label="Leaders" value={stats.users.leaders} />
              <StatCard label="Viewers" value={stats.users.viewers} />
            </div>
          </div>
        </section>

        {/* Alliance Readiness */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text-secondary">Alliance Readiness</h2>
          <Card>
            <div className="space-y-2">
              <ReadinessIndicator label="Ready" count={stats.readiness.ready} variant="success" />
              <ReadinessIndicator label="Needs Setup" count={stats.readiness.needsSetup} variant="warning" />
              <ReadinessIndicator label="New (< 7 days)" count={stats.readiness.new} variant="neutral" />
            </div>
          </Card>
        </section>
      </div>

      {/* Middle Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Setup Funnel */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text-secondary">Setup Funnel</h2>
          <Card>
            <div className="space-y-3">
              {stats.funnel.map((stage) => (
                <FunnelBar
                  key={stage.label}
                  label={stage.label}
                  count={stage.count}
                  maxCount={maxFunnelCount}
                />
              ))}
            </div>
          </Card>
        </section>

        {/* Needs Attention */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text-secondary">Needs Attention</h2>
          <Card>
            <NeedsAttentionList items={stats.needsAttention} />
          </Card>
        </section>
      </div>

      {/* Recent Activity */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-secondary">Recent Activity</h2>
        <Card padding="none">
          {stats.recentActivity.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No recent activity" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="text-text-primary font-medium">
                      {activity.allianceName}
                    </span>
                    <span className="text-text-disabled mx-2">·</span>
                    <span className="text-text-muted text-sm">
                      {activity.description}
                    </span>
                  </div>
                  <span className="text-xs text-text-disabled">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </PageLayout>
  );
}
