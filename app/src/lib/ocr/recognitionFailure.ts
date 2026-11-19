export const temporaryServiceOutcome = "processing-failed:provider-temporary";

const reasons = {
  "provider-temporary": "Google’s text recognition service is temporarily unavailable.",
  "provider-unavailable": "The app couldn’t get a response from Google’s text recognition service.",
  "provider-error": "Google’s text recognition service returned an error for this scan.",
  "response-unreadable": "The app couldn’t read the result returned by Google.",
  "result-too-large": "The recognition result exceeded the app’s processing limit.",
  "provider-response-too-large": "Google’s response exceeded the 512 KiB limit for reading a scan.",
  "recognized-text-too-long": "The screenshot contains more recognized text than one scan supports.",
  "too-many-annotations": "The screenshot contains more recognized words than one scan supports.",
  "recognized-word-too-long": "One recognized text field exceeded the length limit for a single word.",
  "retained-result-too-large": "The extracted scan data exceeded the 64 KiB limit for saving a result.",
  "ranking-analysis": "The app received the recognized text but couldn’t process the screenshot layout.",
} as const;

export type RecognitionFailureReason = keyof typeof reasons;

const densityLimits: RecognitionFailureReason[] = [
  "result-too-large", "provider-response-too-large", "recognized-text-too-long",
  "too-many-annotations", "recognized-word-too-long", "retained-result-too-large",
];
const denseOutcomes = new Set(densityLimits.map(reason => `processing-failed:${reason}`));

export function isDenseRecognition(outcome?: string | null): boolean {
  return !!outcome && denseOutcomes.has(outcome);
}

export class RecognitionFailure extends Error {
  constructor(readonly reason: RecognitionFailureReason) {
    super(reasons[reason]);
  }
}

export function recognitionFailureMessage(outcome?: string | null): string | undefined {
  const prefix = "processing-failed:";
  if (!outcome?.startsWith(prefix)) return;
  const reason = outcome.slice(prefix.length);
  if (Object.hasOwn(reasons, reason)) return reasons[reason as RecognitionFailureReason];
}
