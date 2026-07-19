"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback, type SubmitFeedbackState } from "@/app/feedback/actions";
import { FEEDBACK_CATEGORY_OPTIONS } from "@/app/src/lib/feedbackCategory";
import { AuthError } from "@/app/src/components";
import { Button, Label, Select, Textarea } from "@/app/src/components/client";

const initialState: SubmitFeedbackState = { status: "idle", error: null };

/**
 * Global feedback affordance for authenticated pages.
 *
 * A fixed floating button opens a small panel. The panel is only mounted while
 * open, so its form/action state resets fresh each time (no stale success after
 * reopening). Contextual metadata (path, viewport, app version) is captured for
 * the operator without asking the user - they only answer "what's on your mind?".
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Send feedback"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
        >
          <FeedbackGlyph />
          Feedback
        </button>
      )}

      {open && <FeedbackPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(
    submitFeedback,
    initialState
  );
  const pathname = usePathname();
  const [viewport, setViewport] = useState("");

  // Capture viewport client-side; keep it current if the window is resized
  // before submit.
  useEffect(() => {
    const update = () =>
      setViewport(`${window.innerWidth}x${window.innerHeight}`);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auto-dismiss shortly after a successful submission.
  useEffect(() => {
    if (state.status !== "success") return;
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [state.status, onClose]);

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

  return (
    <div
      role="dialog"
      aria-label="Send feedback"
      aria-modal="false"
      className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-border bg-surface p-4 shadow-2xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          Send feedback
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feedback"
          className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <CloseGlyph />
        </button>
      </div>

      {state.status === "success" ? (
        <div className="py-4 text-center">
          <p className="text-sm text-text-secondary">
            Thanks! Your feedback has been sent directly to the team.
          </p>
          {state.feedbackId && (
            <p className="mt-2 text-xs text-text-muted">
              Ref #{state.feedbackId.slice(0, 8)}
            </p>
          )}
        </div>
      ) : (
        <>
          <AuthError>{state.error}</AuthError>

          <form className="space-y-3" action={formAction}>
            <input type="hidden" name="url" value={pathname ?? ""} />
            <input type="hidden" name="viewport" value={viewport} />
            <input type="hidden" name="appVersion" value={appVersion} />

            <div>
              <Label htmlFor="feedback-category">What&apos;s this about?</Label>
              <Select
                id="feedback-category"
                name="category"
                defaultValue={FEEDBACK_CATEGORY_OPTIONS[0].value}
                disabled={isPending}
              >
                {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                name="message"
                rows={4}
                required
                maxLength={2000}
                disabled={isPending}
                placeholder="What happened, or what would make this better?"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={isPending}
            >
              {isPending ? "Sending..." : "Send feedback"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

function FeedbackGlyph() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
