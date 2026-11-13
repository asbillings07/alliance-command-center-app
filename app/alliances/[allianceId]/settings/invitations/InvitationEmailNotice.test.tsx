import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvitationEmailNotice } from "./InvitationEmailNotice";

describe("invitation delivery notice", () => {
  it.each(["sent", "failed", "skipped", "unknown"] as const)("keeps the manual fallback visible for %s", (status) => {
    const html = renderToStaticMarkup(createElement(InvitationEmailNotice, { status }));
    expect(html).toContain('role="status"');
    expect(html).toContain("share");
    expect(html).toContain("link or code privately");
    if (status === "sent") { expect(html).toContain("accepted for delivery"); expect(html).toContain("Inbox delivery is not confirmed"); }
    else if (status === "skipped") expect(html).toContain("No email was sent");
    else expect(html).toContain("could not be confirmed");
  });
});
