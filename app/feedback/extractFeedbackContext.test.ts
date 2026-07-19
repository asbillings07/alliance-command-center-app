import { describe, it, expect } from "vitest";
import { extractFeedbackContext } from "./extractFeedbackContext";

describe("extractFeedbackContext", () => {
  it("extracts both alliance and period ids from an import URL", () => {
    expect(
      extractFeedbackContext("/alliances/a1/periods/p1/import")
    ).toEqual({ allianceId: "a1", periodId: "p1" });
  });

  it("extracts only the alliance id from an alliance-scoped URL", () => {
    expect(extractFeedbackContext("/alliances/a1/members")).toEqual({
      allianceId: "a1",
    });
  });

  it("ignores query strings and fragments", () => {
    expect(
      extractFeedbackContext("/alliances/a1/periods/p1?tab=x#frag")
    ).toEqual({ allianceId: "a1", periodId: "p1" });
  });

  it("returns an empty context for non-alliance URLs", () => {
    expect(extractFeedbackContext("/platform/overview")).toEqual({});
  });
});
