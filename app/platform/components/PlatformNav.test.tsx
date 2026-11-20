import React from "react";
import { usePathname } from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import type { AdminAllianceWorkspace } from "@/app/src/lib/platform/adminWorkspace";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/platform/overview"),
}));

vi.mock("@/app/src/components/client", () => ({
  AccountNavLink: () => React.createElement("a", { href: "/account" }, "Account"),
  SignOutButton: () => React.createElement("button", null, "Sign Out"),
}));

import { PlatformNav, PlatformNavMobile } from "./PlatformNav";

const singleWorkspace: AdminAllianceWorkspace = {
  kind: "single",
  allianceId: "x",
  allianceName: "Y",
  href: "/alliances/x",
};

const multipleWorkspace: AdminAllianceWorkspace = {
  kind: "multiple",
  count: 3,
  href: "/alliances/select_alliance",
};

describe("PlatformNav", () => {
  it.each(["/platform/activity", "/platform/activity/import-errors"])(
    "highlights only the matching destination on desktop and mobile for %s", (path) => {
      for (const nav of [
        <PlatformNav key="desktop" workspace={singleWorkspace} />,
        <PlatformNavMobile key="mobile" isOpen onClose={() => {}} workspace={singleWorkspace} />,
      ]) {
        vi.mocked(usePathname).mockReturnValueOnce(path);
        const html = renderToStaticMarkup(nav);
        expect(html).toContain('href="/platform/activity/import-errors"');
        expect(html.match(/aria-current="page"/g)).toHaveLength(1);
        expect(html).toContain(`href="${path}" aria-current="page"`);
      }
    },
  );

  it("renders no workspace link when workspace is none", () => {
    const html = renderToStaticMarkup(
      <PlatformNav workspace={{ kind: "none" }} />
    );

    expect(html).not.toContain("Alliance workspace");
    expect(html).not.toContain("My alliances");
  });

  it("renders Alliance workspace with correct href for single membership", () => {
    const html = renderToStaticMarkup(
      <PlatformNav workspace={singleWorkspace} />
    );

    expect(html).toContain("Alliance workspace");
    expect(html).toContain('href="/alliances/x"');
    expect(html).not.toContain("My alliances");
  });

  it("renders My alliances with correct href for multiple memberships", () => {
    const html = renderToStaticMarkup(
      <PlatformNav workspace={multipleWorkspace} />
    );

    expect(html).toContain("My alliances");
    expect(html).toContain('href="/alliances/select_alliance"');
    expect(html).not.toContain("Alliance workspace");
  });
});

describe("PlatformNavMobile", () => {
  it("renders no workspace link when workspace is none", () => {
    const html = renderToStaticMarkup(
      <PlatformNavMobile
        isOpen={true}
        onClose={() => {}}
        workspace={{ kind: "none" }}
      />
    );

    expect(html).not.toContain("Alliance workspace");
    expect(html).not.toContain("My alliances");
  });

  it("renders Alliance workspace with correct href for single membership", () => {
    const html = renderToStaticMarkup(
      <PlatformNavMobile
        isOpen={true}
        onClose={() => {}}
        workspace={singleWorkspace}
      />
    );

    expect(html).toContain("Alliance workspace");
    expect(html).toContain('href="/alliances/x"');
    expect(html).not.toContain("My alliances");
  });

  it("renders My alliances with correct href for multiple memberships", () => {
    const html = renderToStaticMarkup(
      <PlatformNavMobile
        isOpen={true}
        onClose={() => {}}
        workspace={multipleWorkspace}
      />
    );

    expect(html).toContain("My alliances");
    expect(html).toContain('href="/alliances/select_alliance"');
    expect(html).not.toContain("Alliance workspace");
  });
});
