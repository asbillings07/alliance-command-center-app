import { describe, expect, it } from "vitest";
import {
  TOURS_BY_ID,
  IMPORT_MEMBERS_TOUR_ID,
  CREATE_PERIOD_TOUR_ID,
  SMART_IMPORT_TOUR_ID,
} from "./index";

describe("TOURS_BY_ID", () => {
  const knownIds = [
    IMPORT_MEMBERS_TOUR_ID,
    CREATE_PERIOD_TOUR_ID,
    SMART_IMPORT_TOUR_ID,
  ];

  it("registers every known tour with no duplicate keys", () => {
    // Size equal to the distinct id count guards against a duplicate key
    // silently collapsing two tours into one Map entry.
    expect(TOURS_BY_ID.size).toBe(new Set(knownIds).size);
    expect(TOURS_BY_ID.size).toBe(knownIds.length);
  });

  it("resolves each id to the tour whose id matches the key", () => {
    for (const id of knownIds) {
      const tour = TOURS_BY_ID.get(id);
      expect(tour).toBeDefined();
      expect(tour?.id).toBe(id);
    }
  });

  it("returns undefined for an unknown id", () => {
    expect(TOURS_BY_ID.get("not-a-real-tour")).toBeUndefined();
  });
});
