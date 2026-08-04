import { describe, it, expect } from "vitest";
import { formatImportTimestamp } from "./formatImportTimestamp";

describe("formatImportTimestamp", () => {
    it("renders a fixed instant in UTC regardless of the runtime's local time zone", () => {
        // 23:30 UTC — deliberately chosen so a machine in a negative UTC
        // offset (e.g. US timezones) would render a *different calendar
        // day* if the time zone weren't pinned, making any timezone
        // regression obvious rather than accidentally passing.
        const date = new Date("2026-08-04T23:30:00.000Z");

        expect(formatImportTimestamp(date)).toBe("Aug 4, 2026, 11:30 PM UTC");
    });

    it("visibly labels the UTC time zone", () => {
        const date = new Date("2026-01-01T00:00:00.000Z");

        expect(formatImportTimestamp(date)).toContain("UTC");
    });

    it("renders midnight UTC on January 1st as the correct calendar day (not shifted to Dec 31 by a local offset)", () => {
        const date = new Date("2026-01-01T00:00:00.000Z");

        expect(formatImportTimestamp(date)).toBe("Jan 1, 2026, 12:00 AM UTC");
    });
});
