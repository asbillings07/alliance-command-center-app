import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/src/lib/auth";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  clearFeedbackInboxTestHooks,
  setFeedbackInboxListQueryFailuresRemaining,
} from "@/app/src/lib/feedbackInboxTestHooks";

function hooksEnabled(): boolean {
  // Hard-gate on VERCEL_ENV in addition to the feature flag: a misconfigured
  // FEEDBACK_INBOX_TEST_HOOKS value must never make this route live on the
  // real production deployment. VERCEL_ENV="production" is set by Vercel
  // itself only for the production deployment and is not something a stray
  // project env var can override, so this check holds even if the flag is
  // accidentally left set there.
  //
  // Deliberately NOT gated on NODE_ENV: CI's E2E suite runs the app via
  // `next start` (a genuine production build, NODE_ENV="production") so the
  // Playwright tests that arm these hooks can exercise the real production
  // code path — but that CI run is not a Vercel deployment at all, so
  // VERCEL_ENV is unset there, and this check correctly leaves hooks
  // reachable for it while still closing off the real production surface.
  if (process.env["VERCEL_ENV"] === "production") {
    return false;
  }
  return process.env["FEEDBACK_INBOX_TEST_HOOKS"] === "true";
}

async function requirePlatformAdminApi() {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) {
    return null;
  }
  return session;
}

export async function POST(request: NextRequest) {
  if (!hooksEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await requirePlatformAdminApi())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { listFailuresRemaining?: number };
  try {
    body = (await request.json()) as { listFailuresRemaining?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const count = body.listFailuresRemaining;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return NextResponse.json(
      { error: "listFailuresRemaining must be a non-negative number" },
      { status: 400 },
    );
  }

  setFeedbackInboxListQueryFailuresRemaining(count);
  return NextResponse.json({ ok: true, listFailuresRemaining: count });
}

export async function DELETE() {
  if (!hooksEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await requirePlatformAdminApi())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  clearFeedbackInboxTestHooks();
  return NextResponse.json({ ok: true });
}
