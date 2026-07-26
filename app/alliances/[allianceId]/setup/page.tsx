import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import {
  getAllianceSetupStatus,
  SETUP_TASK_TOURS,
  type SetupTask,
} from "@/app/src/lib/allianceSetup";
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

function ChevronIcon() {
  return (
    <svg
      className="w-5 h-5 text-text-disabled"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

function SetupTaskCard({ task }: { task: SetupTask }) {
  // Offer the guided tour whenever the task has one. A tour is educational even
  // after the task is done (revisiting the feature, onboarding a teammate), so
  // it is not gated on completion.
  const tourId = SETUP_TASK_TOURS[task.id];
  const isBlocked = !task.completed && !task.actionable;

  const taskBody = (
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
        <div className="text-sm text-text-muted mt-1">{task.description}</div>
        {isBlocked && task.blockedReason && (
          <p className="text-sm text-text-secondary mt-2">{task.blockedReason}</p>
        )}
      </div>
      {!task.completed && !isBlocked && <ChevronIcon />}
    </div>
  );

  return (
    <div
      className={`rounded-lg border transition-colors ${
        task.completed
          ? "bg-surface-secondary border-border"
          : isBlocked
            ? "bg-surface-secondary border-border"
            : "bg-surface-secondary border-border hover:border-primary"
      }`}
    >
      {isBlocked ? (
        <div className="block p-4">{taskBody}</div>
      ) : (
        <Link href={task.href} className="block p-4">
          {taskBody}
        </Link>
      )}
      {tourId && (
        <div className="px-4 pb-3 pl-11">
          <Link
            href={buildTourHref({
              destination: task.href,
              tourId,
            })}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-light hover:text-primary hover:underline"
          >
            {task.completed ? "Review guided tour" : "Start guided tour"}
          </Link>
        </div>
      )}
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
  // Use status.isComplete which is computed against ALL required tasks,
  // not just those visible to the current user. This prevents roles that
  // can't see any required tasks from incorrectly seeing "complete".
  const allRequiredComplete = status.isComplete;

  return (
    <PageLayout
      title="Alliance Setup"
      description={`Get ${alliance.name} ready for your leadership team.`}
      maxWidth="2xl"
    >
      <section
        aria-labelledby="setup-entry-heading"
        className="mb-8 p-6 bg-primary/10 border border-primary/20 rounded-lg"
      >
        <h2
          id="setup-entry-heading"
          className="text-lg font-medium text-text-primary"
        >
          How would you like to get started?
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Upload your existing spreadsheet to populate evaluation periods, metrics,
          and results in one guided flow. Or walk through each step manually below.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            href={`/alliances/${allianceId}/setup/import`}
          >
            Start with a spreadsheet
          </Button>
          <Link
            href="#manual-setup"
            className="text-sm font-medium text-primary-light hover:text-primary hover:underline text-center sm:text-left"
          >
            Set up manually
          </Link>
        </div>
      </section>

      {!allRequiredComplete && (
        <ProgressBar
          completed={status.requiredComplete}
          total={status.requiredTotal}
        />
      )}

      <div id="manual-setup" className="scroll-mt-6">
        {/* Required Tasks */}
        {requiredTasks.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
              Required Setup
            </h2>
            <div className="space-y-3">
              {requiredTasks.map((task) => (
                <SetupTaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}

        {/* Optional Tasks */}
        {optionalTasks.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
              Next Steps
            </h2>
            <div className="space-y-3">
              {optionalTasks.map((task) => (
                <SetupTaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}
      </div>

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
