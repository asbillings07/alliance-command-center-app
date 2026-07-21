/**
 * Contextual tour definitions.
 *
 * A tour is plain, serializable data: an ordered list of steps that a client
 * runner (see `TourButton`) hands to Driver.js. Keeping definitions free of any
 * client/runtime dependency lets us unit-test them and, later, reference them by
 * `id` when we persist tour preferences (see the Setup Experience roadmap).
 */

export type TourStep = {
  /**
   * CSS selector for the element to highlight. Omit for a centered, elementless
   * step (useful for intro/outro copy that isn't anchored to any one control).
   */
  element?: string;
  title: string;
  description: string;
};

export type TourDefinition = {
  /** Stable identifier, used for analytics and (later) persisted preferences. */
  id: string;
  steps: TourStep[];
  /**
   * Optional handoff copy shown on the destination page after the user COMPLETES
   * the tour (clicks Done). It bridges learning → doing ("Tour complete. You can
   * create your first evaluation period below.") without navigating them away.
   * Only surfaced by `TourAutoStart` on positive completion; dismissing the tour
   * shows nothing. Omit for tours that don't hand off to an on-page action.
   */
  completionMessage?: string;
};
