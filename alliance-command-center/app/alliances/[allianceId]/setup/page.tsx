import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus, type SetupTask } from "@/app/src/lib/allianceSetup";

type Params = {
  params: Promise<{
    allianceId: string;
  }>;
};

function CheckIcon() {
  return (
    <svg
      className="w-5 h-5 text-[#22C55E]"
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
    <div className="w-5 h-5 rounded-full border-2 border-[#4B5563]" />
  );
}

function SetupTaskCard({ task }: { task: SetupTask }) {
  return (
    <Link
      href={task.href}
      className={`block p-4 rounded-lg border transition-colors ${
        task.completed
          ? "bg-[#1F2937] border-[#374151]"
          : "bg-[#1F2937] border-[#374151] hover:border-[#3B82F6]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {task.completed ? <CheckIcon /> : <CircleIcon />}
        </div>
        <div className="flex-1">
          <div
            className={`font-medium ${
              task.completed ? "text-[#9CA3AF]" : "text-[#F9FAFB]"
            }`}
          >
            {task.label}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">
            Typically completed by: {task.typicallyCompletedBy}
          </div>
        </div>
        {!task.completed && (
          <svg
            className="w-5 h-5 text-[#6B7280]"
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
        )}
      </div>
    </Link>
  );
}

export default async function AllianceSetupPage({ params }: Params) {
  const { allianceId } = await params;

  if (!allianceId) {
    redirect("/app");
  }

  await requireAllianceAccess({ allianceId });

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
  });

  if (!alliance) {
    redirect("/app");
  }

  const status = await getAllianceSetupStatus(allianceId);

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#F9FAFB] mb-2">
            Alliance Setup
          </h1>
          <p className="text-[#9CA3AF]">
            Get {alliance.name} ready for your leadership team.
          </p>
        </div>

        {!status.isComplete && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#9CA3AF]">Progress</span>
              <span className="text-[#F9FAFB] font-medium">
                {status.completedCount} of {status.totalCount} complete
              </span>
            </div>
            <div className="h-2 bg-[#1F2937] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3B82F6] rounded-full transition-all duration-300"
                style={{
                  width: `${(status.completedCount / status.totalCount) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="space-y-3 mb-8">
          {status.tasks.map((task) => (
            <SetupTaskCard key={task.id} task={task} />
          ))}
        </div>

        <div className="text-center">
          <Link
            href={`/alliances/${allianceId}`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#3B82F6] text-white font-medium rounded-md hover:bg-[#2563EB]"
          >
            Continue to Dashboard
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </Link>
          <p className="mt-3 text-xs text-[#6B7280]">
            You can always return to setup from your alliance settings
          </p>
        </div>
      </div>
    </div>
  );
}
