import { describe, it, expect } from "vitest";
import { smartImportTour, SMART_IMPORT_TOUR_ID } from "./smartImportTour";

describe("smartImportTour", () => {
  it("uses the stable tour id", () => {
    expect(smartImportTour.id).toBe(SMART_IMPORT_TOUR_ID);
    expect(smartImportTour.id).toBe("smart-import");
  });

  it("has ordered steps with non-empty copy", () => {
    expect(smartImportTour.steps.length).toBeGreaterThan(0);
    for (const step of smartImportTour.steps) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("anchors to data-tour attributes that exist in the upload step", () => {
    const anchoredSelectors = smartImportTour.steps
      .map((step) => step.element)
      .filter((element): element is string => Boolean(element));

    expect(anchoredSelectors).toContain('[data-tour="metric-upload"]');
    expect(anchoredSelectors).toContain('[data-tour="metric-requirements"]');
  });

  it("ends with an elementless step so it works before a file is chosen", () => {
    const lastStep = smartImportTour.steps[smartImportTour.steps.length - 1];
    expect(lastStep.element).toBeUndefined();
  });
});
