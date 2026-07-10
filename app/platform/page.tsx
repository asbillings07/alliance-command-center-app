import { getBetaStats, type NeedsAttentionItem } from "@/app/src/lib/betaDashboard";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";

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
    <div className="bg-[#1F2937] rounded-lg p-4 border border-[#374151]">
      <div className="text-[#9CA3AF] text-sm">{label}</div>
      <div className="text-2xl font-bold text-[#F9FAFB]">{value}</div>
      {subtext && <div className="text-xs text-[#6B7280] mt-1">{subtext}</div>}
    </div>
  );
}

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
      <div className="w-40 text-sm text-[#D1D5DB] text-right">{label}</div>
      <div className="flex-1 h-6 bg-[#374151] rounded overflow-hidden">
        <div
          className="h-full bg-[#3B82F6] transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="w-12 text-sm text-[#F9FAFB] font-mono">{count}</div>
    </div>
  );
}

function ReadinessIndicator({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: "green" | "yellow" | "gray";
}) {
  const colorClasses = {
    green: "bg-green-500/20 text-green-400",
    yellow: "bg-yellow-500/20 text-yellow-400",
    gray: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded ${colorClasses[color]}`}
    >
      <span className="text-sm">{label}</span>
      <span className="font-mono font-medium">{count}</span>
    </div>
  );
}

function NeedsAttentionCard({ items }: { items: NeedsAttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-[#6B7280]">
        <div className="w-12 h-12 mx-auto mb-3 bg-[#1F2937] rounded-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-green-500"
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
        </div>
        <p className="text-sm">No items need attention</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={`${item.type}-${item.id}`}
          className="flex items-center justify-between px-3 py-2 bg-[#1F2937] rounded border border-[#374151]"
        >
          <div>
            <div className="text-sm text-[#F9FAFB]">{item.label}</div>
            <div className="text-xs text-[#6B7280]">{item.detail}</div>
          </div>
          {item.type === "stuck_alliance" && item.daysSinceActivity && (
            <span className="text-xs text-amber-400 font-mono">
              {item.daysSinceActivity}d
            </span>
          )}
        </div>
      ))}
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

export default async function PlatformDashboard() {
  await requirePlatformAdmin();

  const stats = await getBetaStats();

  const maxFunnelCount = Math.max(...stats.funnel.map((s) => s.count), 1);

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F9FAFB]">
      <div className="max-w-6xl mx-auto p-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">Platform Dashboard</h1>
          <p className="text-[#9CA3AF] text-sm mt-1">
            Operational visibility into beta progress
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Alliances Section */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#D1D5DB]">Alliances</h2>
            <div className="space-y-3">
              <StatCard
                label="Total Alliances"
                value={stats.alliances.total}
              />
              <StatCard
                label="Active Today"
                value={stats.alliances.activeToday}
                subtext="with activity in last 24h"
              />
              <StatCard
                label="New This Week"
                value={stats.alliances.newThisWeek}
              />
            </div>
          </section>

          {/* Users Section */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#D1D5DB]">Users</h2>
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
            <h2 className="text-lg font-semibold text-[#D1D5DB]">
              Alliance Readiness
            </h2>
            <div className="bg-[#1F2937] rounded-lg p-4 border border-[#374151] space-y-2">
              <ReadinessIndicator
                label="Ready"
                count={stats.readiness.ready}
                color="green"
              />
              <ReadinessIndicator
                label="Needs Setup"
                count={stats.readiness.needsSetup}
                color="yellow"
              />
              <ReadinessIndicator
                label="New (< 7 days)"
                count={stats.readiness.new}
                color="gray"
              />
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Setup Funnel */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#D1D5DB]">
              Setup Funnel
            </h2>
            <div className="bg-[#1F2937] rounded-lg p-6 border border-[#374151] space-y-3">
              {stats.funnel.map((stage) => (
                <FunnelBar
                  key={stage.label}
                  label={stage.label}
                  count={stage.count}
                  maxCount={maxFunnelCount}
                />
              ))}
            </div>
          </section>

          {/* Needs Attention */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-[#D1D5DB]">
              Needs Attention
            </h2>
            <div className="bg-[#1F2937] rounded-lg p-4 border border-[#374151]">
              <NeedsAttentionCard items={stats.needsAttention} />
            </div>
          </section>
        </div>

        {/* Recent Activity */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[#D1D5DB]">
            Recent Activity
          </h2>
          <div className="bg-[#1F2937] rounded-lg border border-[#374151] divide-y divide-[#374151]">
            {stats.recentActivity.length === 0 ? (
              <div className="p-6 text-center text-[#6B7280] text-sm">
                No recent activity
              </div>
            ) : (
              stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="text-[#F9FAFB] font-medium">
                      {activity.allianceName}
                    </span>
                    <span className="text-[#6B7280] mx-2">·</span>
                    <span className="text-[#9CA3AF] text-sm">
                      {activity.description}
                    </span>
                  </div>
                  <span className="text-xs text-[#6B7280]">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
