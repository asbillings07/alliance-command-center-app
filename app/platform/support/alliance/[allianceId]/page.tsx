import { notFound } from "next/navigation";
import { Badge } from "@/app/src/components";
import {
  getAllianceById,
  getAllianceTimeline,
  getAllianceActivity,
  getAllianceSetupStatusById,
  type AlliancePlatformSetupStatus,
} from "@/app/src/lib/platform";

/**
 * Alliance Detail (Support)
 *
 * Shows detailed alliance information for support purposes.
 * Includes timeline and recent activity.
 */

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
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

type Props = {
  params: Promise<{ allianceId: string }>;
};

const setupStatusConfig: Record<
  AlliancePlatformSetupStatus,
  { variant: "success" | "warning" | "neutral"; label: string }
> = {
  complete: { variant: "success", label: "Setup complete" },
  incomplete: { variant: "warning", label: "Setup incomplete" },
  unavailable: { variant: "neutral", label: "Status unavailable" },
};

export default async function AllianceDetailPage({ params }: Props) {
  const { allianceId } = await params;

  const [alliance, timeline, activity, setupStatus] = await Promise.all([
    getAllianceById(allianceId),
    getAllianceTimeline(allianceId),
    getAllianceActivity(allianceId, 10),
    getAllianceSetupStatusById(allianceId),
  ]);

  if (!alliance) {
    notFound();
  }

  const setupBadge = setupStatusConfig[setupStatus];

  const owner = alliance.memberships.find((m) => m.role === "OWNER");
  const teamMembers = alliance.memberships.filter((m) => m.role !== "OWNER");

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {alliance.name}
          </h1>
          <p className="text-text-muted text-sm mt-1">
            {alliance.server} • Created{" "}
            {alliance.createdAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={setupBadge.variant} size="md">
            {setupBadge.label}
          </Badge>
          <Badge variant="neutral" size="md">
            {alliance._count.allianceMembers} members
          </Badge>
        </div>
      </div>

      {/* Alliance Info */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Owner & Team */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="font-medium text-text-secondary mb-3">Team</h3>
          {owner && (
            <div className="mb-3">
              <div className="text-xs text-text-muted mb-1">Owner</div>
              <div className="text-text-primary">
                {owner.user.displayName || owner.user.email}
              </div>
              <div className="text-xs text-text-muted">{owner.user.email}</div>
            </div>
          )}
          {teamMembers.length > 0 && (
            <div>
              <div className="text-xs text-text-muted mb-2">
                Team ({teamMembers.length})
              </div>
              <div className="space-y-2">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-text-primary">
                      {member.user.displayName || member.user.email}
                    </span>
                    <Badge variant="neutral" size="sm">
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          {teamMembers.length === 0 && !owner && (
            <p className="text-text-muted text-sm">No team members</p>
          )}
        </div>

        {/* Stats */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="font-medium text-text-secondary mb-3">Stats</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {alliance._count.allianceMembers}
              </div>
              <div className="text-xs text-text-muted">Members</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {alliance._count.metrics}
              </div>
              <div className="text-xs text-text-muted">Metrics</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {alliance._count.metricPeriods}
              </div>
              <div className="text-xs text-text-muted">Periods</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-text-primary">
                {alliance._count.invitations}
              </div>
              <div className="text-xs text-text-muted">Invitations</div>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      {timeline && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Timeline
          </h2>
          <div className="bg-surface rounded-lg border border-border p-4">
            <div className="relative">
              {timeline.events.map((event, index) => (
                <div key={event.event} className="flex items-start gap-4 pb-4">
                  {/* Vertical line */}
                  {index < timeline.events.length - 1 && (
                    <div className="absolute left-[11px] top-6 w-0.5 h-[calc(100%-24px)] bg-border" />
                  )}

                  {/* Dot */}
                  <div
                    className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      event.completed
                        ? "bg-success text-white"
                        : "bg-border text-text-disabled"
                    }`}
                  >
                    {event.completed ? (
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-current" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-medium ${event.completed ? "text-text-primary" : "text-text-disabled"}`}
                      >
                        {event.event}
                      </span>
                      <span className="text-xs text-text-muted">
                        {formatDate(event.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent Activity */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Recent Activity
        </h2>
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          {activity.length === 0 ? (
            <div className="p-4 text-text-muted text-sm">No recent activity</div>
          ) : (
            <div className="divide-y divide-border">
              {activity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <span className="text-text-primary text-sm">
                    {item.description}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatTimeAgo(item.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
