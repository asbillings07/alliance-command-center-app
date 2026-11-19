import { describe, expect, it } from "vitest";
import { OCR_PROCESSING_NOTICE, OCR_QUALITY_NOTICE, processingAllowed, qualityAllowed, qualitySourceEligible, type OcrConsentState } from "./consentPolicy";

const processing = { id: 1, granted: true, noticeVersion: OCR_PROCESSING_NOTICE, createdAt: "2026-11-19T10:00:00Z" };
const quality = { id: 2, granted: true, noticeVersion: OCR_QUALITY_NOTICE, createdAt: "2026-11-19T10:00:01Z" };
const now = new Date("2026-11-19T12:00:00Z");
const source = { qualityConsentId: 2, expiresAt: new Date("2026-12-19T10:00:01Z") };

describe("account OCR consent", () => {
  it("defaults both permissions off without manufacturing a refusal", () => {
    const state = { processing: null, quality: null };
    expect(processingAllowed(state)).toBe(false);
    expect(qualityAllowed(state)).toBe(false);
    expect(qualitySourceEligible(state, source, now)).toBe(false);
  });
  it("never makes human review a requirement for OCR", () => {
    expect(processingAllowed({ processing, quality: null })).toBe(true);
    expect(processingAllowed({ processing, quality: { ...quality, granted: false } })).toBe(true);
    expect(processingAllowed({ processing: null, quality })).toBe(false);
  });
  it("rejects an outdated processing notice without granting new permission", () => {
    expect(processingAllowed({ processing: { ...processing, noticeVersion: "old" }, quality })).toBe(false);
  });
  it("requires collection-time and continuing quality permission and original expiry", () => {
    const state: OcrConsentState = { processing, quality };
    expect(qualitySourceEligible(state, source, now)).toBe(true);
    expect(qualitySourceEligible(state, { ...source, qualityConsentId: null }, now)).toBe(false);
    expect(qualitySourceEligible(state, source, source.expiresAt)).toBe(false);
    expect(qualitySourceEligible({ processing, quality: { ...quality, granted: false } }, source, now)).toBe(false);
    expect(qualitySourceEligible({ processing, quality: { ...quality, id: 4 } }, source, now)).toBe(false);
    expect(qualitySourceEligible({ processing, quality: { ...quality, noticeVersion: "old" } }, source, now)).toBe(false);
  });
});
