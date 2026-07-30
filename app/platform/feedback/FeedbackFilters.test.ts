import { describe, it, expect } from "vitest";
import { appendOutOfCapOption } from "./filterOptions";

describe("FeedbackFilters out-of-cap preservation", () => {
  it("appends a selected alliance that is not in the bounded option list", () => {
    const options = appendOutOfCapOption(
      [{ id: "all_1", name: "Alpha Alliance" }],
      "all_deleted",
    );

    expect(options).toEqual([
      { id: "all_1", name: "Alpha Alliance" },
      { id: "all_deleted", name: "all_deleted (selected)" },
    ]);
  });

  it("does not duplicate an option already present in the bounded list", () => {
    const options = appendOutOfCapOption(
      [{ id: "wave-1", name: "Wave 1" }],
      "wave-1",
    );

    expect(options).toEqual([{ id: "wave-1", name: "Wave 1" }]);
  });
});
