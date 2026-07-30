import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/src/lib/auth";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  clearFeedbackInboxTestHooks,
  setFeedbackInboxListQueryFailuresRemaining,
} from "@/app/src/lib/feedbackInboxTestHooks";

function hooksEnabled(): boolean {
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
