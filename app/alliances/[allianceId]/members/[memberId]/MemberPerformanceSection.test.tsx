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
            <a href="/alliances/all_1/periods/per_1/record">Record Results</a>
          </>
        }
      />,
    );

    expect(html).toContain("No results were recorded for this member");
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
