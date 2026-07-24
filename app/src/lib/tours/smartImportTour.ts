import type { TourDefinition } from "./types";

export const SMART_IMPORT_TOUR_ID = "smart-import";

/**
 * Guides a leader through metric import (many metrics from one spreadsheet).
 *
 * Scoped to the always-present upload step; the column-mapping and preview steps
 * only render after a CSV is chosen, so the tour ends with an elementless step
 * setting expectations for mapping and preview.
 */
export const smartImportTour: TourDefinition = {
  id: SMART_IMPORT_TOUR_ID,
  steps: [
    {
      element: '[data-tour="metric-upload"]',
      title: "Upload one spreadsheet",
      description:
        "Export your data once and import evaluation results for several metrics from a single CSV—no need to upload a separate file per metric.",
    },
    {
      element: '[data-tour="metric-requirements"]',
      title: "What the file needs",
      description:
        "Just a player-name column plus one or more numeric metric columns. We match players and auto-detect the columns for you.",
    },
    {
      title: "Map, preview, then import",
      description:
        "Next you'll confirm which metric each column maps to and review the matches. Nothing is saved until you click Import.",
    },
  ],
};
