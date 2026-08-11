import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { MemberPerformanceSection } from "./MemberPerformanceSection";

describe("MemberPerformanceSection unrecorded banner", () => {
  it("shows record/import actions for an active member with no recorded results", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[
          { metricId: "m1", metricName: "Kill Points" },
          { metricId: "m2", metricName: "VS Score" },
        ]}
        unrecordedNotice={
          <>
            <p>No results were recorded for this member in this evaluation period yet.</p>
            <span data-testid="record-results-action">Record Results</span>
          </>
        }
      />,
    );

    expect(html).toContain("No results were recorded for this member");
    expect(html).toContain('data-testid="record-results-action"');
    expect(html).toContain("Record Results");
    expect(html).toContain("Not recorded");
  });

  it("shows read-only copy for archived members with no actions", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[{ metricId: "m1", metricName: "Kill Points" }]}
        unrecordedNotice={
          <p>
            No results were recorded for this period. This member is archived; historical
            results are read-only.
          </p>
        }
      />,
    );

    expect(html).toContain("historical results are read-only");
    expect(html).not.toContain("Record Results");
  });
});

// #319 "current vs previous" decision lock: previous is the immediately
// prior raw entry within the SAME selected period, used only to compute a
// correction delta - never rendered as its own visible number. These cover
// the MetricCard rendering states that fall out of that definition,
// complementing memberPerformanceViewModel.test.ts's view-model-level
// coverage of the same edge cases (see that file's module doc comment for
// the full "current"/"previous" contract).
describe("MemberPerformanceSection MetricCard rendering", () => {
  it("renders the current value with no delta line when there is no previous entry (the common single-entry-per-period case)", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[{ metricId: "m1", metricName: "Kill Points", current: { value: 500, recordedAt: new Date("2026-01-01") } }]}
      />,
    );

    expect(html).toContain("500");
    expect(html).not.toContain("since last entry");
    expect(html).not.toContain("Not recorded");
  });

  it("renders a positive delta as '+N since last entry'", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[
          {
            metricId: "m1",
            metricName: "Kill Points",
            current: { value: 900, recordedAt: new Date("2026-01-02") },
            previous: { value: 850, recordedAt: new Date("2026-01-01") },
            delta: 50,
          },
        ]}
      />,
    );

    expect(html).toContain("+50 since last entry");
  });

  it("renders a negative delta with a leading minus and no double sign", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[
          {
            metricId: "m1",
            metricName: "Kill Points",
            current: { value: 800, recordedAt: new Date("2026-01-02") },
            previous: { value: 900, recordedAt: new Date("2026-01-01") },
            delta: -100,
          },
        ]}
      />,
    );

    expect(html).toContain("-100 since last entry");
    expect(html).not.toContain("+-");
  });

  it("hides the delta line when the correction did not change the value (delta === 0)", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[
          {
            metricId: "m1",
            metricName: "Kill Points",
            current: { value: 900, recordedAt: new Date("2026-01-02") },
            previous: { value: 900, recordedAt: new Date("2026-01-01") },
            delta: 0,
          },
        ]}
      />,
    );

    expect(html).toContain("900");
    expect(html).not.toContain("since last entry");
  });

  it("shows 'Not recorded' - never a stale value or a delta - when current is undefined (e.g. the most recent event was a void)", () => {
    const html = renderToStaticMarkup(
      <MemberPerformanceSection
        emptyState="has-metrics"
        periodName="Week 30"
        metrics={[
          {
            metricId: "m1",
            metricName: "Kill Points",
            previous: { value: 750, recordedAt: new Date("2026-01-01") },
          },
        ]}
      />,
    );

    expect(html).toContain("Not recorded");
    expect(html).not.toContain("750");
    expect(html).not.toContain("since last entry");
  });
});
