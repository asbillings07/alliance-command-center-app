import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { prisma } from "@/app/src/lib/prisma";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { MetricCard } from "./metricCard";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function MetricsPage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();
    await requireLeadershipAccess(allianceId, user.id);
    const metrics = await prisma.metric.findMany({
        where: {
            allianceId: allianceId,
        },
    });

    if (metrics.length === 0) {
        return <div className="text-2xl font-bold">No metrics found, create one to get started!</div>;
    }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-2xl font-bold">Metrics</h1>
      <div>
        <button className="w-full mb-4 rounded-md border-2 border-dashed border-gray-300 p-4 text-gray-500 hover:border-blue-400 hover:text-blue-500 cursor-pointer">Create Metric</button>
        {metrics.length > 0 ? (
          metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))
        ) : (
          <div className="text-2xl font-bold">No metrics found, create one to get started!</div>
        )}
      </div>
    </div>
  );
}