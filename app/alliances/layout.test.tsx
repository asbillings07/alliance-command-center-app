import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement("img", props),
}));

vi.mock("@/app/src/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  isPlatformAdmin: vi.fn(),
}));

vi.mock("@/app/logout/actions", () => ({
  logoutAction: vi.fn(),
}));

vi.mock("@/app/src/components/client", () => ({
  AccountNavLink: () => React.createElement("a", { href: "/account" }, "Account"),
  SignOutButton: () => React.createElement("button", null, "Sign Out"),
  FeedbackWidget: () => null,
}));

vi.mock("driver.js/dist/driver.css", () => ({}));

import type { Session } from "next-auth";
import { auth } from "@/app/src/lib/auth";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import AlliancesLayout from "./layout";

const mockSession = (user: {
  id: string;
  email: string;
  isPlatformAdmin?: boolean;
}): Session => ({
  user: {
    id: user.id,
    email: user.email,
    isPlatformAdmin: user.isPlatformAdmin ?? false,
  },
  expires: "2099-01-01T00:00:00.000Z",
});

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

describe("AlliancesLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(
      mockSession({ id: "user-1", email: "user@example.com" })
    );
  });

  it("renders Platform Console link when isPlatformAdmin resolves true", async () => {
    vi.mocked(isPlatformAdmin).mockResolvedValue(true);

    const layout = await AlliancesLayout({ children: <div>Content</div> });
    const html = renderToStaticMarkup(layout);

    expect(html).toContain("Platform Console");
    expect(html).toContain('href="/platform/overview"');
  });

  it("omits Platform Console link when isPlatformAdmin resolves false", async () => {
    vi.mocked(isPlatformAdmin).mockResolvedValue(false);

    const layout = await AlliancesLayout({ children: <div>Content</div> });
    const html = renderToStaticMarkup(layout);

    expect(html).not.toContain("Platform Console");
    expect(html).not.toContain('href="/platform/overview"');
  });

  it("never shows Platform Console for a regular alliance member session", async () => {
    mockAuth.mockResolvedValue(
      mockSession({ id: "member-1", email: "member@example.com" })
    );
    vi.mocked(isPlatformAdmin).mockResolvedValue(false);

    const layout = await AlliancesLayout({ children: <div>Content</div> });
    const html = renderToStaticMarkup(layout);

    expect(html).not.toContain("Platform Console");
    expect(isPlatformAdmin).toHaveBeenCalledWith("member-1");
  });
});
