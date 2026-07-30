import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/app/src/components/client", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement("input", props),
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) =>
    React.createElement("label", props, children),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
    React.createElement("textarea", props),
}));

vi.mock("./FeedbackTriagePanel", () => ({
  FeedbackTriagePanel: () =>
    React.createElement("div", { "data-testid": "feedback-triage-panel" }),
}));

vi.mock("./FeedbackTriageHistory", () => ({
  FeedbackTriageHistory: () => null,
}));

import { FeedbackCard } from "./FeedbackList";

describe("FeedbackList response indicator copy", () => {
  it('renders "Unreviewed" for legacy items without triage events', () => {
    const html = renderToStaticMarkup(
      <FeedbackCard
        item={{
          feedbackId: "fb-unreviewed",
          category: "BUG",
          message: "Legacy feedback",
          submitterEmail: "legacy@example.test",
          submitterDisplayName: null,
          allianceId: null,
          allianceName: null,
          participantId: null,
          wave: null,
          status: "NEW",
          needsResponse: true,
          hasBeenTriaged: false,
          githubIssueUrl: null,
          stateRevision: 0,
          lastEventAt: null,
          lastStateChangeAt: null,
          lastStateChangeActorEmail: null,
          lastStateChangeActorDisplayName: null,
          createdAt: new Date("2026-07-29T12:00:00Z"),
        }}
      />,
    );

    expect(html).toContain("Unreviewed");
    expect(html).not.toContain("Responded");
  });

  it('renders "No response needed" after triage when needsResponse is false', () => {
    const html = renderToStaticMarkup(
      <FeedbackCard
        item={{
          feedbackId: "fb-reviewed",
          category: "IDEA",
          message: "Reviewed feedback",
          submitterEmail: "reviewed@example.test",
          submitterDisplayName: "Reviewed",
          allianceId: null,
          allianceName: null,
          participantId: null,
          wave: null,
          status: "TRIAGED",
          needsResponse: false,
          hasBeenTriaged: true,
          githubIssueUrl: null,
          stateRevision: 1,
          lastEventAt: new Date("2026-07-29T12:00:00Z"),
          lastStateChangeAt: new Date("2026-07-29T12:00:00Z"),
          lastStateChangeActorEmail: "op@example.test",
          lastStateChangeActorDisplayName: "Operator",
          createdAt: new Date("2026-07-29T12:00:00Z"),
        }}
      />,
    );

    expect(html).toContain("No response needed");
    expect(html).not.toContain("Responded");
  });

  it('shows "No alliance" when alliance context is missing', () => {
    const html = renderToStaticMarkup(
      <FeedbackCard
        item={{
          feedbackId: "fb-no-alliance",
          category: "CONFUSING",
          message: "Missing alliance",
          submitterEmail: "solo@example.test",
          submitterDisplayName: null,
          allianceId: "deleted-alliance",
          allianceName: null,
          participantId: null,
          wave: null,
          status: "NEW",
          needsResponse: true,
          hasBeenTriaged: false,
          githubIssueUrl: null,
          stateRevision: 0,
          lastEventAt: null,
          lastStateChangeAt: null,
          lastStateChangeActorEmail: null,
          lastStateChangeActorDisplayName: null,
          createdAt: new Date("2026-07-29T12:00:00Z"),
        }}
      />,
    );

    expect(html).toContain("No alliance");
  });
});
