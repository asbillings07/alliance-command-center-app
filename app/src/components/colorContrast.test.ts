import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Check the composed colors, not just the token in isolation: a translucent
// status badge can sit on a nested panel, or on an already tinted error row.
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--([a-z-]+): #([\da-f]{6});/gi)].map(([, name, hex]) => [
    name,
    [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16)),
  ]),
);
const surfaces = ["background", "surface", "surface-secondary", "surface-elevated"];

function luminance(rgb: number[]) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground: number[], background: number[]) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

function composite(foreground: number[], background: number[], opacity: number) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

describe("Shared palette readability", () => {
  it("keeps status labels AA-readable on every surface with a 20% tint", () => {
    for (const status of ["primary", "success", "warning", "danger"]) {
      for (const surface of surfaces) {
        const background = composite(tokens[status], tokens[surface], 0.2);
        expect(contrast(tokens[`${status}-light`], background), `${status} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps an error badge readable inside an already tinted error row", () => {
    for (const surface of surfaces) {
      const row = composite(tokens.danger, tokens[surface], 0.2);
      const badge = composite(tokens.danger, row, 0.2);
      expect(contrast(tokens["danger-light"], badge), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps filled actions readable at rest and on hover", () => {
    for (const token of ["primary-hover", "primary-active", "success-dark", "success-active", "warning-dark", "warning-active", "danger-dark", "danger-active"]) {
      expect(contrast([255, 255, 255], tokens[token]), token).toBeGreaterThanOrEqual(4.5);
    }
  });
});
