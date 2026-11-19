export const OCR_PROCESSING_NOTICE = "ocr-processing-2026-11-19";
export const OCR_QUALITY_NOTICE = "ocr-quality-review-2026-11-19";

export type ConsentChoice = { id: number; granted: boolean; noticeVersion: string; createdAt: string } | null;
export type OcrConsentState = { processing: ConsentChoice; quality: ConsentChoice };

export function processingAllowed(state: OcrConsentState) {
  return state.processing?.granted === true && state.processing.noticeVersion === OCR_PROCESSING_NOTICE;
}

export function qualityAllowed(state: OcrConsentState) {
  return state.quality?.granted === true && state.quality.noticeVersion === OCR_QUALITY_NOTICE;
}

/** Necessary permission only: callers must separately authorize reviewer/source access. */
export function qualitySourceEligible(state: OcrConsentState, source: { qualityConsentId: number | null; expiresAt: Date }, now = new Date()) {
  return qualityAllowed(state) && source.qualityConsentId !== null
    && source.qualityConsentId === state.quality?.id && source.expiresAt > now;
}
