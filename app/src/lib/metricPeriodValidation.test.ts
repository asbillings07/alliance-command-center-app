import { describe, it, expect } from "vitest";
import {
  getMetricPeriodFieldError,
  validateMetricPeriodFields,
} from "./metricPeriodValidation";

describe("validateMetricPeriodFields", () => {
  it("rejects reversed date ranges", () => {
    expect(() =>
      validateMetricPeriodFields({
        name: "March 2026",
        startsAt: "2026-04-13",
        endsAt: "2026-03-29",
      }),
    ).toThrow(/start date must be on or before end date/i);
  });
});

describe("getMetricPeriodFieldError", () => {
  it("returns null for valid fields", () => {
    expect(
      getMetricPeriodFieldError({
        name: "March 2026",
        startsAt: "2026-03-01",
        endsAt: "2026-03-31",
      }),
    ).toBeNull();
  });

  it("returns reversed range message without throwing", () => {
    expect(
      getMetricPeriodFieldError({
        name: "March 2026",
        startsAt: "2026-04-13",
        endsAt: "2026-03-29",
      }),
    ).toMatch(/start date must be on or before end date/i);
  });
});
