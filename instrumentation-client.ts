// This file configures the initialization of Sentry on the client.
// The config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProduction = process.env.NODE_ENV === "production";

// Session Replay can capture sensitive on-screen data.
// Only enable when explicitly configured via environment variable.
const enableReplay = process.env.NEXT_PUBLIC_SENTRY_REPLAY === "true";

// Only initialize Sentry if a DSN is configured
if (dsn) {
  Sentry.init({
    dsn,

    // Add Session Replay only when explicitly enabled
    integrations: enableReplay ? [Sentry.replayIntegration()] : [],

    // Conservative sampling in production to avoid excessive telemetry
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    // Enable logs in development only
    enableLogs: !isProduction,

    // Session Replay sampling (only applies if replay integration is enabled)
    // Sample 1% of sessions in production, 10% in development
    replaysSessionSampleRate: isProduction ? 0.01 : 0.1,

    // Capture 100% of sessions with errors for debugging
    replaysOnErrorSampleRate: 1.0,

    // Environment tag for filtering in Sentry dashboard
    environment: process.env.NODE_ENV || "development",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
