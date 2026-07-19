import { describe, it, expect } from "vitest";
import { importMembersTour, IMPORT_MEMBERS_TOUR_ID } from "./importMembersTour";

describe("importMembersTour", () => {
  it("uses the stable tour id", () => {
    expect(importMembersTour.id).toBe(IMPORT_MEMBERS_TOUR_ID);
    expect(importMembersTour.id).toBe("import-members");
  });

  it("has ordered steps with non-empty copy", () => {
    expect(importMembersTour.steps.length).toBeGreaterThan(0);

    for (const step of importMembersTour.steps) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("anchors to data-tour attributes that exist in the upload step", () => {
    const anchoredSelectors = importMembersTour.steps
      .map((step) => step.element)
      .filter((element): element is string => Boolean(element));

    expect(anchoredSelectors).toContain('[data-tour="roster-upload"]');
    expect(anchoredSelectors).toContain('[data-tour="roster-columns"]');
  });

  it("ends with an elementless step so it works before a file is chosen", () => {
    const lastStep = importMembersTour.steps[importMembersTour.steps.length - 1];
    expect(lastStep.element).toBeUndefined();
  });
});
