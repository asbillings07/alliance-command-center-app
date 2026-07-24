/**
 * Strict Localized Integer Parser Utility
 * 
 * Safely parses plain, period-grouped (e.g. 450.000.000), and comma-grouped
 * (e.g. 450,000,000) integer strings without silent truncation or coercion.
 * Enforces PostgreSQL 32-bit signed integer bounds (-2,147,483,648 to 2,147,483,647).
 */

export type ParseStrictIntegerResult =
  | { success: true; value: number }
  | { success: false; error: string };

const MIN_INT32 = BigInt("-2147483648");
const MAX_INT32 = BigInt("2147483647");

/**
 * Parse an input string into a 32-bit signed integer using strict grammar rules.
 * 
 * Accepted formats:
 * - Plain integer: "450000000", "-15"
 * - Period-grouped integer: "450.000.000", "-450.000.000"
 * - Comma-grouped integer: "450,000,000", "-450,000,000"
 * 
 * Rejections:
 * - Empty string or whitespace-only
 * - Internal whitespace (e.g. "450 000")
 * - Decimals / fractions (e.g. "450.5")
 * - Trailing dots or symbols (e.g. "450.")
 * - Mixed separators (e.g. "450,000.000")
 * - Malformed grouping (e.g. "45.00.000")
 * - Values outside 32-bit signed integer range
 */
export function parseStrictInteger(input: string): ParseStrictIntegerResult {
  if (typeof input !== "string") {
    return { success: false, error: "Input must be a string" };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, error: "Input is empty" };
  }

  // Reject internal whitespace
  if (/\s/.test(trimmed)) {
    return { success: false, error: "Internal whitespace is not permitted" };
  }

  let normalizedDigits: string | null = null;

  // 1. Check for plain integer
  if (/^[+-]?\d+$/.test(trimmed)) {
    normalizedDigits = trimmed;
  }
  // 2. Check for period-grouped integer (e.g., 450.000.000)
  else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    normalizedDigits = trimmed.replace(/\./g, "");
  }
  // 3. Check for comma-grouped integer (e.g., 450,000,000)
  else if (/^[+-]?\d{1,3}(,\d{3})+$/.test(trimmed)) {
    normalizedDigits = trimmed.replace(/,/g, "");
  }

  if (normalizedDigits === null) {
    return {
      success: false,
      error: `Invalid integer format "${input}". Expected plain (450000000), period-grouped (450.000.000), or comma-grouped (450,000,000) integer.`,
    };
  }

  try {
    const parsedBigInt = BigInt(normalizedDigits);

    if (parsedBigInt < MIN_INT32 || parsedBigInt > MAX_INT32) {
      return {
        success: false,
        error: `Value "${trimmed}" (${parsedBigInt}) is out of 32-bit signed integer range (-2,147,483,648 to 2,147,483,647)`,
      };
    }

    return { success: true, value: Number(parsedBigInt) };
  } catch {
    return {
      success: false,
      error: `Failed to parse "${input}" as an integer`,
    };
  }
}

/**
 * Helper to check if a string is a valid strict integer format and in range.
 */
export function isValidIntegerString(input: string): boolean {
  return parseStrictInteger(input).success;
}
