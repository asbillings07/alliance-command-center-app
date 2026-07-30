import type { FeedbackInboxFilterOption } from "@/app/src/lib/platform/feedbackInbox";

/** Preserve an out-of-cap selected filter value in bounded dropdowns (#176 decision 12). */
export function appendOutOfCapOption(
  options: FeedbackInboxFilterOption[],
  selectedId: string | undefined,
): FeedbackInboxFilterOption[] {
  if (!selectedId) {
    return options;
  }
  if (options.some((option) => option.id === selectedId)) {
    return options;
  }
  return [
    ...options,
    {
      id: selectedId,
      name: `${selectedId} (selected)`,
    },
  ];
}
