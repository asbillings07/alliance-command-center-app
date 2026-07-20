import type { TourDefinition } from "./types";

export const CREATE_PERIOD_TOUR_ID = "create-period";

/**
 * Orients a leader on the Evaluation Periods page.
 *
 * Anchored to the always-present "+ Create Period" trigger; the create/edit
 * forms and existing-period controls are conditionally rendered, so the tour
 * ends with an elementless step describing what comes after a period exists.
 */
export const createPeriodTour: TourDefinition = {
  id: CREATE_PERIOD_TOUR_ID,
  steps: [
    {
      element: '[data-tour="create-period"]',
      title: "Create an evaluation period",
      description:
        "Periods are time-boxed windows—a season, a month, a single war—that you measure member performance against.",
    },
    {
      title: "Then configure and track",
      description:
        "After creating a period, assign the metrics you care about to it, then record or import each member's numbers for that window.",
    },
  ],
};
