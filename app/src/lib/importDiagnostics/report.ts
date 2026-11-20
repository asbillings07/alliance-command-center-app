import type { Reason, Workflow } from "./codes";

// Diagnostic delivery is best effort. Never send the file, filename, user-entered text or exception.
export function reportImportIssue(allianceId: string, workflow: Workflow, code: Reason, requestId?: string) {
  void import("./reportAction")
    .then(({ reportImportError }) => reportImportError(allianceId, workflow, code, process.env.NEXT_PUBLIC_APP_BUILD, requestId))
    .catch(() => {});
}

export function showImportIssue(allianceId: string, workflow: Workflow, code: Reason, show: (text: string) => void, text: string) {
  show(text);
  reportImportIssue(allianceId, workflow, code);
}
