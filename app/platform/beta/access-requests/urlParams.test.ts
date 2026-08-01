import { describe, it, expect } from "vitest";
import {
  accessRequestFiltersToUrlState,
  buildAccessRequestHref,
  parseAccessRequestPageParams,
} from "./urlParams";

describe("parseAccessRequestPageParams", () => {
  it("defaults to no status filter, page 1, pageSize 20", () => {
    const { filters, page, pageSize } = parseAccessRequestPageParams({});
    expect(filters).toEqual({ status: undefined, search: undefined });
    expect(page).toBe(1);
    expect(pageSize).toBe(20);
  });

  it("accepts a valid status and rejects an invalid one", () => {
    expect(parseAccessRequestPageParams({ status: "PENDING" }).filters.status).toBe("PENDING");
    expect(parseAccessRequestPageParams({ status: "NOT_A_STATUS" }).filters.status).toBeUndefined();
  });

  it("bounds and passes through the search term", () => {
    expect(parseAccessRequestPageParams({ search: "someone@example.test" }).filters.search).toBe(
      "someone@example.test",
    );
  });
});

describe("buildAccessRequestHref", () => {
  it("status cards replace the status filter and toggle off when active", () => {
    expect(buildAccessRequestHref({ status: "PENDING", search: "bug" }, { toggleStatus: "PENDING" })).toBe(
      "/platform/beta/access-requests?search=bug",
    );
    expect(buildAccessRequestHref({ search: "bug" }, { toggleStatus: "DECLINED" })).toBe(
      "/platform/beta/access-requests?search=bug&status=DECLINED",
    );
  });

  it("clearStatus removes the status filter while preserving search", () => {
    expect(buildAccessRequestHref({ status: "PENDING", search: "wave" }, { clearStatus: true })).toBe(
      "/platform/beta/access-requests?search=wave",
    );
  });

  it("filter navigation always drops the page param", () => {
    expect(buildAccessRequestHref({ page: "3", status: "PENDING" }, { toggleStatus: "INVITED" })).toBe(
      "/platform/beta/access-requests?status=INVITED",
    );
  });
});

describe("accessRequestFiltersToUrlState", () => {
  it("omits page/pageSize at their defaults", () => {
    expect(accessRequestFiltersToUrlState({}, 1, 20)).toEqual({
      status: undefined,
      search: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });

  it("serializes non-default page/pageSize", () => {
    expect(accessRequestFiltersToUrlState({ status: "DECLINED" }, 2, 50)).toEqual({
      status: "DECLINED",
      search: undefined,
      page: "2",
      pageSize: "50",
    });
  });
});
