import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus, type SetupTask } from "@/app/src/lib/allianceSetup";
import { PageLayout, Card, Button } from "@/app/src/components";

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
  return (
    <Link
      href={task.href}
      className={`block p-4 rounded-lg border transition-colors ${
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
          <div className="text-xs text-text-disabled mt-1">
            Typically completed by: {task.typicallyCompletedBy}
          </div>
        </div>
        {!task.completed && <ChevronIcon />}
      </div>
    </Link>
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

  return (
    <PageLayout
      title="Alliance Setup"
      description={`Get ${alliance.name} ready for your leadership team.`}
      maxWidth="2xl"
    >
      {!status.isComplete && (
        <ProgressBar
          completed={status.completedCount}
          total={status.totalCount}
        />
      )}

      <div className="space-y-3 mb-8">
        {status.tasks.map((task) => (
          <SetupTaskCard key={task.id} task={task} />
        ))}
      </div>

      <div className="text-center">
        <Button variant="primary" size="lg" href={`/alliances/${allianceId}`}>
          Continue to Dashboard →
        </Button>
        <p className="mt-3 text-xs text-text-disabled">
          You can always return to setup from your alliance settings
        </p>
      </div>
    </PageLayout>
  );
}
