/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./action", () => ({ resendInvitationAction: vi.fn(), cancelInvitationAction: vi.fn() }));
import { resendInvitationAction, cancelInvitationAction } from "./action";
import { PendingInvitations } from "./PendingInvitations";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const invitations = ["one", "two"].map((id) => ({ id, playerNameSnapshot: id, email: `${id}@example.com`, membershipRole: "LEADER", createdAt: "2026-11-01", expiresAt: "2099-12-01", invitedBy: { displayName: "Owner" } }));
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(resendInvitationAction).mockResolvedValue({ data: { inviteUrl: "https://example.com/invite/old-link", inviteCode: "OLD-CODE", emailStatus: "sent" } });
  vi.mocked(cancelInvitationAction).mockResolvedValue({});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(PendingInvitations, { allianceId: "alliance-1", invitations })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
describe("resend result lifecycle", () => {
  it("clears the stale link and reports uncertainty when a renewal response is lost", async () => {
    await click("Resend");
    expect(container.textContent).toContain("old-link");
    vi.mocked(resendInvitationAction).mockRejectedValueOnce(new Error("private provider error"));
    await click("Resend");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("may have been replaced");
    expect(container.textContent).not.toContain("old-link");
    expect(container.textContent).not.toContain("Invitation renewed");
    expect(container.textContent).not.toContain("private provider error");
    expect(resendInvitationAction).toHaveBeenCalledTimes(2);
  });
  it("clears the validity notice when an invitation is canceled while another remains", async () => {
    await click("Resend");
    await click("Cancel");
    expect(cancelInvitationAction).toHaveBeenCalledWith("alliance-1", "one");
    expect(container.textContent).not.toContain("old-link");
    expect(container.textContent).not.toContain("Email accepted for delivery");
  });
});
