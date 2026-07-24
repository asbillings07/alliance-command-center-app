import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import {
  getAllianceSetupStatus,
  SETUP_TASK_TOURS,
  type SetupTask,
} from "@/app/src/lib/allianceSetup";
import { type PermissionSet } from "@/app/src/lib/auth/permissions";
import { buildTourHref } from "@/app/src/lib/tours";
import { PageLayout } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

function CheckIcon() {
  return (
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
  );
}

function CircleIcon() {
  return (
    <div className="w-5 h-5 rounded-full border-2 border-border-hover" />
  );
}

function OperatingHierarchyCard() {
  return (
    <div className="p-4 bg-surface-secondary border border-border rounded-lg mb-6 text-sm space-y-3">
      <h3 className="font-semibold text-text-primary text-base">
        How Alliance Command Center Works
      </h3>
      <p className="text-text-muted">
        ACC organizes leadership decision-making into four core steps:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="p-3 bg-surface border border-border rounded-lg">
          <span className="font-semibold text-text-primary block">
            1. Evaluation Period (When)
          </span>
          <p className="text-xs text-text-muted mt-1">
            Time-boxed container for tracking performance (e.g. Season 7).
          </p>
        </div>
        <div className="p-3 bg-surface border border-border rounded-lg">
          <span className="font-semibold text-text-primary block">
            2. Metrics (What)
          </span>
          <p className="text-xs text-text-muted mt-1">
            Key performance indicators tracked during a period (e.g. VS Points).
          </p>
        </div>
        <div className="p-3 bg-surface border border-border rounded-lg">
          <span className="font-semibold text-text-primary block">
            3. Roster Members (Who)
          </span>
          <p className="text-xs text-text-muted mt-1">
            The active alliance players evaluated in your workspace.
          </p>
        </div>
        <div className="p-3 bg-surface border border-border rounded-lg">
          <span className="font-semibold text-text-primary block">
            4. Evaluation Results (Values)
          </span>
          <p className="text-xs text-text-muted mt-1">
            Recorded metric values for each roster member in a period.
          </p>
        </div>
      </div>
    </div>
  );
}

function SpreadsheetEntryBanner({
  allianceId,
  permissions,
}: {
  allianceId: string;
  permissions: PermissionSet;
}) {
  if (!permissions.canImportMembers && !permissions.canConfigurePeriods) {
    return null;
  }

  return (
    <div className="p-5 bg-primary/5 border border-primary/20 rounded-lg mb-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          Choose How to Get Started
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Start with a roster spreadsheet or follow our guided step-by-step setup flow.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {permissions.canImportMembers && (
          <div className="p-4 bg-surface border border-border rounded-lg flex flex-col justify-between space-y-3">
            <div>
              <div className="font-semibold text-text-primary">
                Start from a roster spreadsheet
              </div>
              <p className="text-xs text-text-muted mt-1">
                Import names, THP, and roles from a CSV spreadsheet. You’ll configure a period and import evaluation results afterward.
              </p>
            </div>
            <div>
              <Button
                variant="primary"
                size="sm"
                href={`/alliances/${allianceId}/members/import`}
              >
                Import Roster →
              </Button>
            </div>
          </div>
        )}

        <div className="p-4 bg-surface border border-border rounded-lg flex flex-col justify-between space-y-3">
          <div>
            <div className="font-semibold text-text-primary">
              Set up manually step-by-step
            </div>
            <p className="text-xs text-text-muted mt-1">
              Period-first guided flow: create an evaluation period, attach metrics, add members, and record evaluation results.
            </p>
          </div>
          <div>
            <Button variant="secondary" size="sm" href="#manual-setup-tasks">
              Follow Guided Steps ↓
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupTaskCard({
  task,
  allianceId,
  permissions,
}: {
  task: SetupTask;
  allianceId: string;
  permissions: PermissionSet;
}) {
  const tourId = SETUP_TASK_TOURS[task.id];

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        task.completed
          ? "bg-surface-secondary border-border"
          : "bg-surface-secondary border-border hover:border-primary"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {task.completed ? <CheckIcon /> : <CircleIcon />}
        </div>
        <div className="flex-1">
          <div
            className={`font-medium ${
              task.completed ? "text-text-muted" : "text-text-primary"
            }`}
          >
            {task.label}
          </div>
          <div className="text-sm text-text-muted mt-1">
            {task.description}
          </div>

          {/* Action Links */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {task.id === "period" && permissions.canConfigurePeriods && (
              <Button
                variant="secondary"
                size="sm"
                href={`/alliances/${allianceId}/periods`}
              >
                Create Evaluation Period
              </Button>
            )}

            {task.id === "metrics" && permissions.canConfigurePeriods && (
              <Button
                variant="secondary"
                size="sm"
                href={`/alliances/${allianceId}/periods`}
              >
                Choose Period Metrics
              </Button>
            )}

            {task.id === "members" && (
              <>
                {permissions.canManageMembers && (
                  <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/members`}
                  >
                    Add Member Manually
                  </Button>
                )}
                {permissions.canImportMembers && (
                  <Button
                    variant="secondary"
                    size="sm"
                    href={`/alliances/${allianceId}/members/import`}
                  >
                    Import Roster
                  </Button>
                )}
              </>
            )}

            {task.id === "data" && permissions.canImportMetrics && (
              <Button
                variant="secondary"
                size="sm"
                href={`/alliances/${allianceId}/periods`}
              >
                Select Period to Record or Import Results
              </Button>
            )}

            {task.id === "team" && permissions.canInviteCollaborators && (
              <Button
                variant="secondary"
                size="sm"
                href={`/alliances/${allianceId}/settings/invitations`}
              >
                Invite Leadership Team
              </Button>
            )}

            {tourId && (
              <Link
                href={buildTourHref({
                  destination: task.href,
                  tourId,
                })}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-light hover:text-primary hover:underline"
              >
                {task.completed ? "Review guided tour" : "Start guided tour"}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-text-muted">Progress</span>
        <span className="text-text-primary font-medium">
          {completed} of {total} complete
        </span>
      </div>
      <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default async function AllianceSetupPage({ params }: Params) {
  const { allianceId } = await params;

  if (!allianceId) {
    redirect("/app");
  }

  const auth = await requireAllianceAccess({ allianceId });

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
  });

  if (!alliance) {
    redirect("/app");
  }

  // Filter tasks to only those the user can complete
  const status = await getAllianceSetupStatus(allianceId, auth.permissions);

  const requiredTasks = status.tasks.filter((t) => t.required);
  const optionalTasks = status.tasks.filter((t) => !t.required);
  // Setup is complete when all required data hierarchy tasks are completed
  const allRequiredComplete = status.isComplete;

  return (
    <PageLayout
      title="Alliance Setup"
      description={`Get ${alliance.name} ready for your leadership team.`}
      maxWidth="2xl"
    >
      <OperatingHierarchyCard />

      {!allRequiredComplete && (
        <SpreadsheetEntryBanner
          allianceId={allianceId}
          permissions={auth.permissions}
        />
      )}

      {!allRequiredComplete && (
        <ProgressBar
          completed={status.requiredComplete}
          total={status.requiredTotal}
        />
      )}

      {/* Required Data Setup Tasks */}
      {requiredTasks.length > 0 && (
        <div id="manual-setup-tasks" className="mb-8">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
            Data Setup Sequence
          </h2>
          <div className="space-y-3">
            {requiredTasks.map((task) => (
              <SetupTaskCard
                key={task.id}
                task={task}
                allianceId={allianceId}
                permissions={auth.permissions}
              />
            ))}
          </div>
        </div>
      )}

      {/* Optional Collaboration Tasks */}
      {optionalTasks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
            Collaboration & Next Steps
          </h2>
          <div className="space-y-3">
            {optionalTasks.map((task) => (
              <SetupTaskCard
                key={task.id}
                task={task}
                allianceId={allianceId}
                permissions={auth.permissions}
              />
            ))}
          </div>
        </div>
      )}

      <div className="text-center pt-4 border-t border-border">
        {allRequiredComplete ? (
          <>
            <Button variant="primary" size="lg" href={`/alliances/${allianceId}`}>
              Continue to Dashboard →
            </Button>
            <p className="mt-3 text-sm text-success">
              All required setup is complete!
            </p>
          </>
        ) : (
          <>
            <Button variant="secondary" size="lg" href={`/alliances/${allianceId}`}>
              Skip to Dashboard
            </Button>
            <p className="mt-3 text-xs text-text-disabled">
              You can complete setup later from the dashboard
            </p>
          </>
        )}
      </div>
    </PageLayout>
  );
}
