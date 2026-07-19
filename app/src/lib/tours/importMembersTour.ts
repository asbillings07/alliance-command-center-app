import type { TourDefinition } from "./types";

export const IMPORT_MEMBERS_TOUR_ID = "import-members";

/**
 * Guides a new leader through the member roster import.
 *
 * Scoped to the initial upload screen: the preview and complete steps are only
 * rendered after a CSV is chosen, so their controls don't exist in the DOM yet.
 * The tour ends by setting expectations for what happens after upload.
 *
 * Element selectors target `data-tour` attributes in RosterImportForm so the
 * tour is decoupled from styling classes.
 */
export const importMembersTour: TourDefinition = {
  id: IMPORT_MEMBERS_TOUR_ID,
  steps: [
    {
      element: '[data-tour="roster-upload"]',
      title: "Upload your roster",
      description:
        "Export your alliance roster to a CSV, then drop it here. We'll read it right in your browser—nothing is saved yet.",
    },
    {
      element: '[data-tour="roster-columns"]',
      title: "Name your columns",
      description:
        "Only a player-name column is required. We auto-detect common headers for name, hero power, and role. Extra columns are ignored.",
    },
    {
      title: "Review before importing",
      description:
        "After uploading you'll review and edit each member, and members you already have are skipped automatically. Nothing is created until you confirm.",
    },
  ],
};
