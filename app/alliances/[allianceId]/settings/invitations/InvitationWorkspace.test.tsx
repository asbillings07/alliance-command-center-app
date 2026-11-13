/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./action", () => ({ inviteCollaborator: vi.fn(), searchMembersAction: vi.fn(), resendInvitationAction: vi.fn(), cancelInvitationAction: vi.fn() }));
vi.mock("./PlayerNameCombobox", () => ({
  PlayerNameCombobox: ({ onSelect }: { onSelect: (selection: { type: "new"; playerName: string }) => void }) =>
    <button type="button" onClick={() => onSelect({ type: "new", playerName: "Draft Player" })}>Select draft player</button>,
}));
import { inviteCollaborator, resendInvitationAction, cancelInvitationAction } from "./action";
import { InvitationWorkspace } from "./InvitationWorkspace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const invitations = [{ id: "existing-invite", playerNameSnapshot: "Existing Player", email: "existing@example.com", membershipRole: "LEADER", createdAt: "2026-11-01", expiresAt: "2099-12-01", invitedBy: { displayName: "Owner" } }];
function creationResult(invitationId = "new-invite") {
  return { data: { invitationId, inviteUrl: "https://example.com/invite/new-link", inviteCode: "NEW-CODE", memberCreated: true, emailStatus: "skipped" as const } };
}
function button(label: string) {
  const match = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing ${label}`);
  return match;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function prepareDraft() {
  await click("Select draft player");
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("#email")!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "draft@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(resendInvitationAction).mockResolvedValue({ data: { inviteUrl: "https://example.com/invite/renewed", inviteCode: "RENEWED", emailStatus: "skipped" } });
  vi.mocked(cancelInvitationAction).mockResolvedValue({});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(InvitationWorkspace, { allianceId: "alliance-1", invitations })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("invitation workspace state", () => {
  it.each(["Resend", "Cancel"])("preserves an unrelated unsaved draft during %s", async (operation) => {
    await prepareDraft();
    await click(operation);
    expect(container.querySelector<HTMLInputElement>("#email")?.value).toBe("draft@example.com");
    expect(button("Send Invitation").disabled).toBe(false);
    expect(inviteCollaborator).not.toHaveBeenCalled();
  });

  it.each(["Resend", "Cancel"])("preserves an in-flight creation and its result during %s", async (operation) => {
    let finish!: (value: ReturnType<typeof creationResult>) => void;
    vi.mocked(inviteCollaborator).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await prepareDraft();
    await click("Send Invitation");
    expect(button("Sending...").disabled).toBe(true);
    await click(operation);
    expect(button("Sending...").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#email")?.value).toBe("draft@example.com");
    // Even an explicit form submission cannot bypass the pending guard.
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(inviteCollaborator).toHaveBeenCalledTimes(1);
    await act(async () => finish(creationResult()));
    expect(container.textContent).toContain("Invitation created");
    expect(container.querySelector<HTMLInputElement>('input[value="NEW-CODE"]')).not.toBeNull();
  });

  it("does not restore a retired creation link when its response arrives late", async () => {
    let finish!: (value: ReturnType<typeof creationResult>) => void;
    vi.mocked(inviteCollaborator).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await prepareDraft();
    await click("Send Invitation");
    await click("Resend");
    await act(async () => finish(creationResult("existing-invite")));
    expect(container.textContent).not.toContain("Invitation created");
    expect(container.querySelector<HTMLInputElement>('input[value="NEW-CODE"]')).toBeNull();
    expect(container.textContent).toContain("Invitation renewed");
  });
});
