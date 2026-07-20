import { describe, it, expect } from "vitest";
import { createPeriodTour, CREATE_PERIOD_TOUR_ID } from "./createPeriodTour";

describe("createPeriodTour", () => {
  it("uses the stable tour id", () => {
    expect(createPeriodTour.id).toBe(CREATE_PERIOD_TOUR_ID);
    expect(createPeriodTour.id).toBe("create-period");
  });

  it("has ordered steps with non-empty copy", () => {
    expect(createPeriodTour.steps.length).toBeGreaterThan(0);
    for (const step of createPeriodTour.steps) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("anchors to the always-present create-period trigger", () => {
    expect(createPeriodTour.steps[0].element).toBe('[data-tour="create-period"]');
  });

  it("ends with an elementless step so it works before any period exists", () => {
    const lastStep = createPeriodTour.steps[createPeriodTour.steps.length - 1];
    expect(lastStep.element).toBeUndefined();
  });
});
