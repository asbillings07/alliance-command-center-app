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
 *
 * Security: Error details are only included in development.
 * Production returns generic messages to avoid leaking internal details.
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

const CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.npm_package_version ||
    "local";

  const isDevelopment = process.env.NODE_ENV === "development";

  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version,
        checks: {
          database: "ok",
        },
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    // Always log the full error server-side for debugging
    console.error("[Health Check] Database connection failed:", error);

    // Only include error details in development to avoid leaking internals
    const errorMessage = isDevelopment
      ? error instanceof Error
        ? error.message
        : "Unknown error"
      : "Database connection failed";

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
      { status: 503, headers: CACHE_HEADERS }
    );
  }
}
