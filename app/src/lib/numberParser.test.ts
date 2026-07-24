import { describe, it, expect } from "vitest";
import { parseStrictInteger, isValidIntegerString } from "./numberParser";

describe("numberParser", () => {
  describe("parseStrictInteger", () => {
    it("parses valid plain integers", () => {
      expect(parseStrictInteger("450000000")).toEqual({ success: true, value: 450000000 });
      expect(parseStrictInteger("0")).toEqual({ success: true, value: 0 });
      expect(parseStrictInteger("-15")).toEqual({ success: true, value: -15 });
      expect(parseStrictInteger("+100")).toEqual({ success: true, value: 100 });
    });

    it("parses valid period-grouped integers", () => {
      expect(parseStrictInteger("450.000.000")).toEqual({ success: true, value: 450000000 });
      expect(parseStrictInteger("1.000")).toEqual({ success: true, value: 1000 });
      expect(parseStrictInteger("-450.000.000")).toEqual({ success: true, value: -450000000 });
    });

    it("parses valid comma-grouped integers", () => {
      expect(parseStrictInteger("450,000,000")).toEqual({ success: true, value: 450000000 });
      expect(parseStrictInteger("1,000")).toEqual({ success: true, value: 1000 });
      expect(parseStrictInteger("-450,000,000")).toEqual({ success: true, value: -450000000 });
    });

    it("trims surrounding whitespace", () => {
      expect(parseStrictInteger("  450.000.000  ")).toEqual({ success: true, value: 450000000 });
    });

    it("rejects internal whitespace", () => {
      const res = parseStrictInteger("450 000 000");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("Internal whitespace");
      }
    });

    it("rejects empty or whitespace-only strings", () => {
      expect(parseStrictInteger("")).toEqual({ success: false, error: "Input is empty" });
      expect(parseStrictInteger("   ")).toEqual({ success: false, error: "Input is empty" });
    });

    it("rejects decimals and floating point numbers", () => {
      expect(parseStrictInteger("450.5").success).toBe(false);
      expect(parseStrictInteger("12.34").success).toBe(false);
    });

    it("rejects malformed grouping", () => {
      expect(parseStrictInteger("45.00.000").success).toBe(false);
      expect(parseStrictInteger("450.00").success).toBe(false);
      expect(parseStrictInteger("1,23").success).toBe(false);
    });

    it("rejects mixed separators", () => {
      expect(parseStrictInteger("450,000.000").success).toBe(false);
      expect(parseStrictInteger("450.000,000").success).toBe(false);
    });

    it("rejects trailing separators or nonnumeric characters", () => {
      expect(parseStrictInteger("450.").success).toBe(false);
      expect(parseStrictInteger("450,").success).toBe(false);
      expect(parseStrictInteger("abc450").success).toBe(false);
      expect(parseStrictInteger("450pt").success).toBe(false);
    });

    it("accepts exact 32-bit signed integer boundaries", () => {
      expect(parseStrictInteger("2147483647")).toEqual({ success: true, value: 2147483647 });
      expect(parseStrictInteger("-2147483648")).toEqual({ success: true, value: -2147483648 });
      expect(parseStrictInteger("2.147.483.647")).toEqual({ success: true, value: 2147483647 });
      expect(parseStrictInteger("-2.147.483.648")).toEqual({ success: true, value: -2147483648 });
    });

    it("rejects values exceeding 32-bit signed integer bounds", () => {
      const overflow = parseStrictInteger("2147483648");
      expect(overflow.success).toBe(false);
      if (!overflow.success) {
        expect(overflow.error).toContain("out of 32-bit signed integer range");
      }

      const underflow = parseStrictInteger("-2147483649");
      expect(underflow.success).toBe(false);

      const huge = parseStrictInteger("999.999.999.999");
      expect(huge.success).toBe(false);
    });
  });

  describe("isValidIntegerString", () => {
    it("returns true for valid integers", () => {
      expect(isValidIntegerString("450.000.000")).toBe(true);
      expect(isValidIntegerString("100")).toBe(true);
    });

    it("returns false for invalid integers", () => {
      expect(isValidIntegerString("450.5")).toBe(false);
      expect(isValidIntegerString("abc")).toBe(false);
    });
  });
});
