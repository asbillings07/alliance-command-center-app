import * as Sentry from "@sentry/nextjs";
import { validateEnv } from "@/app/src/lib/env";

export async function register() {
  // Validate environment variables once at server startup
  validateEnv();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
