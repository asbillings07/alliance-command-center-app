/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccessRequestInboxListItem } from "@/app/src/lib/platform/accessRequestInbox";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

// Same established workaround as BetaWaveSelect.test.tsx / FeedbackList.test.tsx.
// The forwardRef renderers are named function expressions (rather than
// top-level consts, which vi.mock's hoisting would make inaccessible) so
// react/display-name can infer a name for each.
vi.mock("@/app/src/components/client", () => {
  const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea(props, ref) {
      return React.createElement("textarea", { ...props, ref });
    },
  );
  const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    function Select(props, ref) {
      return React.createElement("select", { ...props, ref }, props.children);
    },
  );
  const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return React.createElement("input", { ...props, ref });
    },
  );

  return {
    Button: ({
      children,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
      React.createElement("button", { ...props, "aria-busy": loading }, children),
    Label: ({
      children,
      required,
      ...props
    }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) =>
      React.createElement("label", props, children, required ? React.createElement("span", null, "*") : null),
    Textarea,
    Select,
    Input,
  };
});

vi.mock("./AccessRequestHistory", () => ({
  AccessRequestHistory: () => null,
}));

const mockCheckConflict = vi.fn();
const mockAddNote = vi.fn();
const mockDecline = vi.fn();
const mockResolve = vi.fn();
const mockReopen = vi.fn();
const mockConvert = vi.fn();

vi.mock("./actions", () => ({
  checkAccessRequestConflictAction: (...args: unknown[]) => mockCheckConflict(...args),
  addAccessRequestNoteAction: (...args: unknown[]) => mockAddNote(...args),
  declineAccessRequestAction: (...args: unknown[]) => mockDecline(...args),
  resolveExistingAccessAction: (...args: unknown[]) => mockResolve(...args),
  reopenAccessRequestAction: (...args: unknown[]) => mockReopen(...args),
  convertAccessRequestAction: (...args: unknown[]) => mockConvert(...args),
}));

import { AccessRequestActionsPanel } from "./AccessRequestActionsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function buildItem(overrides: Partial<AccessRequestInboxListItem> = {}): AccessRequestInboxListItem {
  return {
    accessRequestId: "ar_1",
    name: "Tester",
    email: "tester@example.test",
    allianceName: null,
    message: "Please let me in",
    createdAt: new Date("2026-07-20T12:00:00Z"),
    status: "PENDING",
    betaWave: null,
    linkedInvitationId: null,
    currentReason: null,
    stateRevision: 0,
    lastEventAt: null,
    lastEventActorEmail: null,
    lastEventActorDisplayName: null,
    lastStateChangeAt: null,
    lastStateChangeActorEmail: null,
    lastStateChangeActorDisplayName: null,
    ...overrides,
  };
}

function buildProjection(overrides: Record<string, unknown> = {}) {
  return {
    accessRequestId: "ar_1",
    status: "PENDING",
    linkedInvitationId: null,
    betaWave: null,
    conflictUserId: null,
    conflictUserIdSnapshot: null,
    conflictUserEmail: null,
    conflictUserDisplayName: null,
    conflictAllianceId: null,
    conflictAllianceIdSnapshot: null,
    conflictAllianceName: null,
    conflictMembershipCount: null,
    currentReason: null,
    stateRevision: 1,
    lastEventAt: new Date("2026-07-21T12:00:00Z"),
    lastEventActorEmail: "op@example.test",
    lastEventActorDisplayName: "Operator",
    lastStateChangeAt: new Date("2026-07-21T12:00:00Z"),
    lastStateChangeActorEmail: "op@example.test",
    lastStateChangeActorDisplayName: "Operator",
    ...overrides,
  };
}

async function mount(item: AccessRequestInboxListItem) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AccessRequestActionsPanel, {
        item,
        waveOptions: [{ id: "Wave 1", name: "Wave 1" }],
        onRequestWaveOptions: vi.fn(),
      }),
    );
  });
}

function findButton(text: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    typeof text === "string" ? button.textContent === text : text.test(button.textContent ?? ""),
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("AccessRequestActionsPanel — conflict-gated approval", () => {
  it("shows the approve-and-invite form when the pre-check finds no conflict", async () => {
    mockCheckConflict.mockResolvedValue({ success: true, resolution: { primary: { type: "NONE" }, all: [] } });

    await mount(buildItem());
    await flush();

    expect(container.querySelector('[data-testid="access-request-approve-section"]')).not.toBeNull();
    expect(findButton("Approve and invite")).toBeDefined();
    // Disabled until a wave is chosen (design decision 3).
    expect(findButton("Approve and invite")?.disabled).toBe(true);
  });

  it("shows alliance evidence and a Resolve action for EXISTING_ALLIANCE_ACCESS, with no invite form", async () => {
    mockCheckConflict.mockResolvedValue({
      success: true,
      resolution: {
        primary: {
          type: "EXISTING_ALLIANCE_ACCESS",
          userId: "u1",
          userEmail: "tester@example.test",
          userDisplayName: "Tester",
          allianceId: "all_1",
          allianceName: "Alpha Alliance",
          membershipCount: 1,
        },
        all: [],
      },
    });

    await mount(buildItem());
    await flush();

    expect(container.querySelector('[data-testid="access-request-existing-access"]')).not.toBeNull();
    expect(container.textContent).toContain("Alpha Alliance");
    expect(findButton("Resolve — already has access")).toBeDefined();
    expect(container.querySelector('[data-testid="access-request-approve-section"]')).toBeNull();
  });

  it("shows a plain-language notice and a Beta-page link for other conflict types, with no Resolve action", async () => {
    mockCheckConflict.mockResolvedValue({
      success: true,
      resolution: {
        primary: { type: "ACTIVE_PENDING_INVITATION", invitationId: "inv_1" },
        all: [],
      },
    });

    await mount(buildItem());
    await flush();

    const notice = container.querySelector('[data-testid="access-request-conflict-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Active pending invitation");
    expect(container.querySelector('a[href^="/platform/beta?search="]')).not.toBeNull();
    expect(findButton(/Resolve/)).toBeUndefined();
    expect(container.querySelector('[data-testid="access-request-approve-section"]')).toBeNull();
  });
});

describe("AccessRequestActionsPanel — approve and invite", () => {
  it("submits the chosen wave and shows an honest delivery disposition on success", async () => {
    mockCheckConflict.mockResolvedValue({ success: true, resolution: { primary: { type: "NONE" }, all: [] } });
    mockConvert.mockResolvedValue({
      success: true,
      inviteCode: "ABC-DEF",
      inviteUrl: "https://example.test/redeem/tok",
      email: "tester@example.test",
      disposition: { type: "ATTEMPTED", status: "sent" },
      projection: buildProjection({ status: "INVITED", betaWave: "Wave 1" }),
    });

    await mount(buildItem());
    await flush();

    const select = container.querySelector('[data-testid="ar_1-wave-select"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "existing:0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const approveButton = findButton("Approve and invite")!;
    expect(approveButton.disabled).toBe(false);

    await act(async () => {
      approveButton.click();
    });
    await flush();

    expect(mockConvert).toHaveBeenCalledWith("ar_1", "Wave 1", 0);
    expect(container.querySelector('[data-testid="access-request-convert-success"]')).not.toBeNull();
    expect(container.textContent).toContain("Invitation email sent to tester@example.test");
  });

  it("shows the conflict-recovery banner on CONVERSION_BLOCKED and lets the operator refresh the baseline", async () => {
    mockCheckConflict.mockResolvedValue({ success: true, resolution: { primary: { type: "NONE" }, all: [] } });
    mockConvert.mockResolvedValue({
      success: false,
      code: "CONVERSION_BLOCKED",
      error: "This user already has access to an alliance",
      conflict: buildProjection({
        conflictAllianceName: "Alpha Alliance",
        conflictUserEmail: "tester@example.test",
      }),
      conflictType: "EXISTING_ALLIANCE_ACCESS",
    });

    await mount(buildItem());
    await flush();

    const select = container.querySelector('[data-testid="ar_1-wave-select"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "existing:0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      findButton("Approve and invite")!.click();
    });
    await flush();

    const recovery = container.querySelector('[data-testid="access-request-conflict-recovery"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toContain("Approval blocked");
    expect(recovery?.textContent).toContain("Alpha Alliance");

    mockCheckConflict.mockResolvedValue({
      success: true,
      resolution: {
        primary: {
          type: "EXISTING_ALLIANCE_ACCESS",
          userId: "u1",
          userEmail: "tester@example.test",
          userDisplayName: "Tester",
          allianceId: "all_1",
          allianceName: "Alpha Alliance",
          membershipCount: 1,
        },
        all: [],
      },
    });

    await act(async () => {
      findButton("Use current state")!.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="access-request-conflict-recovery"]')).toBeNull();
    // The refreshed baseline retriggers the pre-check, which now correctly
    // reflects the conflict that blocked conversion.
    expect(container.querySelector('[data-testid="access-request-existing-access"]')).not.toBeNull();
  });
});

describe("AccessRequestActionsPanel — decline / note / reopen", () => {
  it("declines a pending request with a required reason", async () => {
    mockCheckConflict.mockResolvedValue({ success: true, resolution: { primary: { type: "NONE" }, all: [] } });
    mockDecline.mockResolvedValue({ success: true, projection: buildProjection({ status: "DECLINED" }) });

    await mount(buildItem());
    await flush();

    await act(async () => {
      findButton("Decline")!.click();
    });

    const textarea = container.querySelector(
      '[data-testid="access-request-decline-reason"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "Spam signup");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      findButton("Confirm decline")!.click();
    });
    await flush();

    expect(mockDecline).toHaveBeenCalledWith("ar_1", "Spam signup", 0);
    expect(container.querySelector('[data-testid="access-request-success"]')?.textContent).toContain(
      "declined",
    );
  });

  it("shows the reopen-denied recovery banner without silently retrying", async () => {
    mockReopen.mockResolvedValue({
      success: false,
      code: "REOPEN_DENIED_ACCESS_STILL_EXISTS",
      error: "Reopen denied: this identity still shows existing alliance access (Alpha Alliance).",
      conflict: buildProjection({
        status: "RESOLVED_EXISTING_ACCESS",
        conflictAllianceName: "Alpha Alliance",
      }),
    });

    await mount(buildItem({ status: "RESOLVED_EXISTING_ACCESS", currentReason: "Already a member" }));

    await act(async () => {
      findButton("Reopen")!.click();
    });
    const textarea = container.querySelector(
      '[data-testid="access-request-reopen-reason"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "Double check");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton("Confirm reopen")!.click();
    });
    await flush();

    const recovery = container.querySelector('[data-testid="access-request-conflict-recovery"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toContain("Reopen denied");
    expect(recovery?.textContent).toContain("Alpha Alliance");
  });

  it("adds an internal note without changing status", async () => {
    mockCheckConflict.mockResolvedValue({ success: true, resolution: { primary: { type: "NONE" }, all: [] } });
    mockAddNote.mockResolvedValue({ success: true, projection: buildProjection({ stateRevision: 1 }) });

    await mount(buildItem());
    await flush();

    const textarea = container.querySelector('[data-testid="access-request-note-input"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "Following up by email");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton("Add note")!.click();
    });
    await flush();

    expect(mockAddNote).toHaveBeenCalledWith("ar_1", "Following up by email");
    expect(container.querySelector('[data-testid="access-request-success"]')?.textContent).toContain(
      "Note added",
    );
  });
});
