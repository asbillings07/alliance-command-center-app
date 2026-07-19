import type { FeedbackCategory } from "@/app/generated/prisma/enums";

/**
 * Human-friendly labels for feedback categories.
 *
 * The enum names stay developer-friendly (BUG/IDEA/CONFUSING); the UI and the
 * operator notification present language users identify with ("I got stuck"
 * more readily than "this was confusing"). Shared so the widget dropdown and
 * the notification email never drift apart.
 */
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  BUG: "Something's broken",
  IDEA: "I have an idea",
  CONFUSING: "Something was confusing",
};

/** Ordered options for the widget's category selector. */
export const FEEDBACK_CATEGORY_OPTIONS: ReadonlyArray<{
  value: FeedbackCategory;
  label: string;
}> = [
  { value: "BUG", label: FEEDBACK_CATEGORY_LABELS.BUG },
  { value: "IDEA", label: FEEDBACK_CATEGORY_LABELS.IDEA },
  { value: "CONFUSING", label: FEEDBACK_CATEGORY_LABELS.CONFUSING },
];

/** Narrow an arbitrary string to a known feedback category. */
export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return value === "BUG" || value === "IDEA" || value === "CONFUSING";
}
