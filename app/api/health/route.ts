import { NextResponse } from "next/server";
import { prisma } from "@/app/src/lib/prisma";

/**
 * Health Check Endpoint
 *
 * Returns the health status of the application.
 * Used for:
 * - Uptime monitoring
 * - Load balancer health checks
 * - Deployment verification
 * - Post-deploy smoke tests
 */

type HealthStatus = {
  status: "healthy" | "unhealthy";
  timestamp: string;
  version: string;
  checks: {
    database: "ok" | "error";
  };
  error?: string;
};

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.npm_package_version ||
    "local";

  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version,
      checks: {
        database: "ok",
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        version,
        checks: {
          database: "error",
        },
        error: errorMessage,
      },
      { status: 503 }
    );
  }
}
