export const temporaryServiceOutcome = "processing-failed:provider-temporary";

const reasons = {
  "provider-temporary": "Google’s text recognition service is temporarily unavailable.",
  "provider-unavailable": "The app couldn’t get a response from Google’s text recognition service.",
  "provider-error": "Google’s text recognition service returned an error for this scan.",
  "response-unreadable": "The app couldn’t read the result returned by Google.",
  "result-too-large": "The recognition result exceeded the app’s processing limit.",
  "ranking-analysis": "The app received the recognized text but couldn’t process the screenshot layout.",
} as const;

export type RecognitionFailureReason = keyof typeof reasons;

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
