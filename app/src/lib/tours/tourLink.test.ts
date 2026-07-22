import { describe, expect, it } from "vitest";
import { buildTourHref, stripTourParams, TOUR_QUERY_PARAM } from "./tourLink";

describe("buildTourHref", () => {
  it("appends the tour param to the destination", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/periods",
      tourId: "create-period",
    });

    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/alliances/a1/periods");
    expect(url.searchParams.get(TOUR_QUERY_PARAM)).toBe("create-period");
  });

  it("does not add a returnTo param", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/members/import",
      tourId: "import-members",
    });

    expect(href).not.toContain("returnTo");
  });

  it("preserves an existing query on the destination", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/periods?foo=1",
      tourId: "create-period",
    });

    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("foo")).toBe("1");
    expect(url.searchParams.get(TOUR_QUERY_PARAM)).toBe("create-period");
  });

  it("throws when the destination is not a same-origin path", () => {
    for (const destination of [
      "https://evil.com",
      "//evil.com",
      "javascript:alert(1)",
      "alliances/a1/periods",
    ]) {
      expect(() => buildTourHref({ destination, tourId: "t" })).toThrow(
        /destination must be a same-origin path/
      );
    }
  });
});

describe("stripTourParams", () => {
  it("removes the tour param", () => {
    expect(stripTourParams("?tour=create-period")).toBe("");
  });

  it("preserves unrelated params", () => {
    expect(stripTourParams("?tour=x&foo=1&bar=2")).toBe("?foo=1&bar=2");
  });

  it("returns an empty string when there is no query", () => {
    expect(stripTourParams("")).toBe("");
  });
});
