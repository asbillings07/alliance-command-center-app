import Link from "next/link";
import type { SetupTask } from "@/app/src/lib/allianceSetup";

export type SetupProgressCardProps = {
  allianceId: string;
  completedCount: number;
  totalCount: number;
  recommendedTask: SetupTask | null;
};

/**
 * Persistent entry point into the setup experience, shown on the alliance
 * dashboard. Renders overall progress and the recommended next step, and links
 * to the full setup page.
 *
 * Completion is derived upstream (see getAllianceSetupStatus); this component
 * only reflects it. It renders nothing once there is no applicable remaining
 * work, so it naturally disappears as the alliance becomes configured.
 */
export function SetupProgressCard({
  allianceId,
  completedCount,
  totalCount,
  recommendedTask,
}: SetupProgressCardProps) {
  if (totalCount === 0 || completedCount >= totalCount) {
    return null;
  }

  const percentage = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-primary">Alliance Setup</h3>
          <p className="text-sm text-text-muted mt-1">
            {completedCount} of {totalCount} complete
          </p>
        </div>
        <Link
          href={`/alliances/${allianceId}/setup`}
          className="shrink-0 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover"
        >
          Continue Setup
        </Link>
      </div>

      <div className="mt-3 h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {recommendedTask && (
        <p className="mt-3 text-sm">
          <span className="text-text-muted">Next step: </span>
          <span className="font-medium text-text-primary">
            {recommendedTask.label}
          </span>
        </p>
      )}
    </div>
  );
}
