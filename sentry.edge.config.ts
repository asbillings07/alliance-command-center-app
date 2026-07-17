// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
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
