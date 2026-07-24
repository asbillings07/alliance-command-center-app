import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalize";

describe("normalizeEmail", () => {
  describe("trimming", () => {
    it("removes leading whitespace", () => {
      expect(normalizeEmail("  user@example.com")).toBe("user@example.com");
    });

    it("removes trailing whitespace", () => {
      expect(normalizeEmail("user@example.com  ")).toBe("user@example.com");
    });

    it("removes both leading and trailing whitespace", () => {
      expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com");
    });

    it("handles tabs and newlines", () => {
      expect(normalizeEmail("\t\nuser@example.com\n\t")).toBe("user@example.com");
    });
  });

  describe("lowercasing", () => {
    it("converts uppercase to lowercase", () => {
      expect(normalizeEmail("USER@EXAMPLE.COM")).toBe("user@example.com");
    });

    it("converts mixed case to lowercase", () => {
      expect(normalizeEmail("UsEr@ExAmPlE.CoM")).toBe("user@example.com");
    });

    it("preserves already lowercase emails", () => {
      expect(normalizeEmail("user@example.com")).toBe("user@example.com");
    });
  });

  describe("combined normalization", () => {
    it("applies both trimming and lowercasing", () => {
      expect(normalizeEmail("  USER@EXAMPLE.COM  ")).toBe("user@example.com");
    });

    it("handles real-world registration variations", () => {
      const variations = [
        "User@Example.com",
        " user@example.com ",
        "USER@EXAMPLE.COM",
        "\tuser@example.com\n",
      ];

      variations.forEach((variation) => {
        expect(normalizeEmail(variation)).toBe("user@example.com");
      });
    });
  });

  describe("preserves Gmail-specific address features", () => {
    it("preserves plus-addressing", () => {
      expect(normalizeEmail("user+tag@gmail.com")).toBe("user+tag@gmail.com");
    });

    it("preserves dots in local part", () => {
      expect(normalizeEmail("user.name@gmail.com")).toBe("user.name@gmail.com");
    });

    it("does not collapse dots (no Gmail-specific normalization)", () => {
      expect(normalizeEmail("u.s.e.r@gmail.com")).toBe("u.s.e.r@gmail.com");
      expect(normalizeEmail("u.s.e.r@gmail.com")).not.toBe("user@gmail.com");
    });

    it("does not strip plus tags (no Gmail-specific normalization)", () => {
      expect(normalizeEmail("user+test@gmail.com")).toBe("user+test@gmail.com");
      expect(normalizeEmail("user+test@gmail.com")).not.toBe("user@gmail.com");
    });
  });

  describe("legacy re-export compatibility", () => {
    it("maintains backward compatibility through emailAddress.ts", async () => {
      // Import through deprecated path
      const { normalizeEmail: legacyNormalize } = await import("../emailAddress");
      
      expect(legacyNormalize("  USER@EXAMPLE.COM  ")).toBe("user@example.com");
      expect(legacyNormalize("user+tag@gmail.com")).toBe("user+tag@gmail.com");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(normalizeEmail("")).toBe("");
    });

    it("handles whitespace-only string", () => {
      expect(normalizeEmail("   ")).toBe("");
    });

    it("handles international characters", () => {
      expect(normalizeEmail("Über@Example.com")).toBe("über@example.com");
    });

    it("handles special characters in local part", () => {
      expect(normalizeEmail("user!#$%@example.com")).toBe("user!#$%@example.com");
    });
  });

  describe("consistency across identity boundaries", () => {
    it("produces same result for credential sign-in and registration", () => {
      const email = "  UsEr+TeSt@ExAmPlE.CoM  ";
      expect(normalizeEmail(email)).toBe("user+test@example.com");
    });

    it("produces same result for Google OAuth and invitation lookup", () => {
      const email = " Google.User@Gmail.com ";
      expect(normalizeEmail(email)).toBe("google.user@gmail.com");
    });

    it("produces same result for beta invitation and access request", () => {
      const email = "\tBeta.Tester+Founder@Example.com\n";
      expect(normalizeEmail(email)).toBe("beta.tester+founder@example.com");
    });
  });
});
