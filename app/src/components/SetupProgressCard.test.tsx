import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { SetupProgressCard } from "./SetupProgressCard";
import type { SetupTask } from "@/app/src/lib/allianceSetup";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

const recommendedTask: SetupTask = {
  id: "period",
  label: "Create Evaluation Period",
  description: "Set up a time-boxed period to track member performance",
  completed: false,
  href: "/alliances/all_1/periods",
  typicallyCompletedBy: "Founding Operator",
  required: true,
  actionable: true,
};

describe("SetupProgressCard", () => {
  it("links Continue Setup to the recommended task href when present", () => {
    const html = renderToStaticMarkup(
      <SetupProgressCard
        allianceId="all_1"
        completedCount={0}
        totalCount={4}
        recommendedTask={recommendedTask}
      />,
    );

    expect(html).toContain('href="/alliances/all_1/periods"');
    expect(html).toContain("Continue Setup");
    expect(html).toContain("Next step:");
    expect(html).toContain("Create Evaluation Period");
  });

  it("falls back to the setup checklist when no recommended task", () => {
    const html = renderToStaticMarkup(
      <SetupProgressCard
        allianceId="all_1"
        completedCount={1}
        totalCount={4}
        recommendedTask={null}
      />,
    );

    expect(html).toContain('href="/alliances/all_1/setup"');
    expect(html).not.toContain("Next step:");
  });

  it("renders nothing when all applicable tasks are complete", () => {
    const html = renderToStaticMarkup(
      <SetupProgressCard
        allianceId="all_1"
        completedCount={4}
        totalCount={4}
        recommendedTask={null}
      />,
    );

    expect(html).toBe("");
  });
});
