export const workflows = {
  screenshot: "Ranking screenshots",
  setup: "Spreadsheet setup",
  evaluation: "Evaluation spreadsheet",
  roster: "Roster spreadsheet",
  historical: "Historical roster spreadsheet",
} as const;
export type Workflow = keyof typeof workflows;

export const reasons = {
  unsupported_format: "Unsupported file format",
  encrypted: "Password-protected workbook",
  malformed: "File could not be read",
  file_too_large: "File exceeds the upload limit",
  workbook_too_large: "Workbook exceeds processing limits",
  no_worksheets: "Workbook has no worksheets",
  invalid_selection: "File selection exceeds the permitted size, count or format",
  empty_sheet: "Selected worksheet is empty",
  missing_player_column: "Player column could not be identified",
  review_blocked: "Import validation blocked review",
  missing_identity: "Rows contain values without a player name",
  invalid_values: "Mapped cells contain invalid metric values",
  no_values: "Mapped columns contain no usable values",
  missing_mapping: "No metric columns were mapped",
  metric_permission: "Creating a metric requires additional permission",
  no_matches: "No usable rows matched",
  save_rejected: "Import could not be applied",
  save_unconfirmed: "The browser could not confirm the save",
  scan_unconfirmed: "The browser could not complete the scan request",
  result_unavailable: "The browser could not open the scan result",
} as const;
export type Reason = keyof typeof reasons;
