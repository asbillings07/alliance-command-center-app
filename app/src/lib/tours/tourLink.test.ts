import { describe, expect, it } from "vitest";
import {
  buildTourHref,
  stripTourParams,
  TOUR_QUERY_PARAM,
  RETURN_TO_QUERY_PARAM,
} from "./tourLink";

describe("buildTourHref", () => {
  it("appends the tour and returnTo params", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/periods",
      tourId: "create-period",
      returnTo: "/alliances/a1/setup",
    });

    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/alliances/a1/periods");
    expect(url.searchParams.get(TOUR_QUERY_PARAM)).toBe("create-period");
    expect(url.searchParams.get(RETURN_TO_QUERY_PARAM)).toBe(
      "/alliances/a1/setup"
    );
  });

  it("percent-encodes the returnTo path", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/members/import",
      tourId: "import-members",
      returnTo: "/alliances/a1/setup",
    });

    // The raw string must be encoded so the slashes don't leak into the query.
    expect(href).toContain(`${RETURN_TO_QUERY_PARAM}=%2Falliances%2Fa1%2Fsetup`);
  });

  it("preserves an existing query on the destination", () => {
    const href = buildTourHref({
      destination: "/alliances/a1/periods?foo=1",
      tourId: "create-period",
      returnTo: "/x",
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
      expect(() =>
        buildTourHref({ destination, tourId: "t", returnTo: "/x" })
      ).toThrow(/same-origin path/);
    }
  });
});

describe("stripTourParams", () => {
  it("removes only the tour params", () => {
    expect(stripTourParams("?tour=create-period&returnTo=%2Fx")).toBe("");
  });

  it("preserves unrelated params", () => {
    expect(stripTourParams("?tour=x&foo=1&returnTo=%2Fx&bar=2")).toBe(
      "?foo=1&bar=2"
    );
  });

  it("returns an empty string when there is no query", () => {
    expect(stripTourParams("")).toBe("");
  });
});
