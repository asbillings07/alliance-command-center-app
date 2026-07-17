import Link from "next/link";
import { Badge } from "@/app/src/components";
import { getRecentActivity, type ActivityType } from "@/app/src/lib/platform";

/**
 * Platform Activity
 *
 * Answers: "What happened?"
 *
 * Full chronological feed with filters.
 */

const activityTypeConfig: Record<
  ActivityType,
  { label: string; icon: string; color: string }
> = {
  alliance_created: { label: "Alliance Created", icon: "🏰", color: "primary" },
  metrics_configured: {
    label: "Metrics Configured",
    icon: "📊",
    color: "success",
  },
  period_created: { label: "Period Created", icon: "📅", color: "info" },
  members_imported: { label: "Members Imported", icon: "👥", color: "success" },
  data_imported: { label: "Data Imported", icon: "📈", color: "success" },
  collaborator_invited: {
    label: "Collaborator Invited",
    icon: "✉️",
    color: "info",
  },
  collaborator_accepted: {
    label: "Collaborator Accepted",
    icon: "✅",
    color: "success",
  },
  beta_accepted: { label: "Beta Accepted", icon: "🎉", color: "primary" },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return "Today";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Normalize a date to midnight local time for grouping.
 * Returns a numeric key (YYYYMMDD) for consistent grouping
 * and the normalized Date object for display.
 */
function normalizeToDay(date: Date): { key: number; normalized: Date } {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const key =
    normalized.getFullYear() * 10000 +
    (normalized.getMonth() + 1) * 100 +
    normalized.getDate();
  return { key, normalized };
}

function groupActivityByDate(
  activity: Awaited<ReturnType<typeof getRecentActivity>>
) {
  const groups = new Map<
    number,
    { date: Date; items: Awaited<ReturnType<typeof getRecentActivity>> }
  >();

  for (const item of activity) {
    const { key, normalized } = normalizeToDay(item.timestamp);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { date: normalized, items: [item] });
    }
  }

  // Sort by key descending (most recent first)
  return Array.from(groups.values()).sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );
}

export default async function PlatformActivity() {
  const activity = await getRecentActivity({ limit: 50 });
  const groupedActivity = groupActivityByDate(activity);

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-text-secondary">Live Feed</h1>

      {activity.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <p>No activity yet.</p>
          <p className="text-sm mt-1">
            Activity will appear here as alliances are created and used.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedActivity.map((group) => (
            <div key={group.date.toISOString()}>
              <h2 className="text-sm font-medium text-text-muted mb-3 sticky top-0 bg-background py-2">
                {formatDate(group.date)}
              </h2>
              <div className="bg-surface rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border">
                  {group.items.map((item) => {
                    const config = activityTypeConfig[item.type];
                    return (
                      <Link
                        key={item.id}
                        href={item.href || "#"}
                        className="flex items-center gap-4 px-4 py-3 hover:bg-surface-secondary transition-colors"
                      >
                        {/* Time */}
                        <span className="text-xs text-text-disabled font-mono w-12 flex-shrink-0">
                          {formatTime(item.timestamp)}
                        </span>

                        {/* Icon */}
                        <span className="text-lg flex-shrink-0">
                          {config.icon}
                        </span>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary font-medium truncate">
                              {item.allianceName}
                            </span>
                          </div>
                          <p className="text-sm text-text-muted truncate">
                            {item.description}
                          </p>
                        </div>

                        {/* Badge */}
                        <Badge variant="neutral" size="sm" className="flex-shrink-0">
                          {config.label}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
