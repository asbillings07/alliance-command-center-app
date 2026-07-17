// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

// Only initialize Sentry if a DSN is configured
if (dsn) {
  Sentry.init({
    dsn,

    // Conservative sampling in production to avoid excessive telemetry
    // Development uses 100% for debugging, production uses 10%
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Enable logs in development only
    enableLogs: process.env.NODE_ENV !== "production",

    // Environment tag for filtering in Sentry dashboard
    environment: process.env.NODE_ENV || "development",
  });
}
