import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeScreenshot } from "./image";
describe("screenshot admission", () => {
  it("decodes and normalizes a real PNG, stripping metadata", async () => {
    const png = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#112233" } }).png().withMetadata().toBuffer();
    const result = await normalizeScreenshot(png);
    expect(result).toMatchObject({ width: 400, height: 600 }); expect(result.digest).toHaveLength(64);
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });
  it.each([new Uint8Array(), new Uint8Array(2 * 1024 * 1024 + 1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"/>'), Buffer.from("not an image")])("rejects unsupported or oversized input before OCR", async input => {
    await expect(normalizeScreenshot(input)).rejects.toThrow();
  });
  it("rejects excessive decoded dimensions and tiny crops", async () => {
    for (const [width, height] of [[4000, 4000], [100, 100]]) {
      const bytes = await sharp({ create: { width, height, channels: 3, background: "#112233" } }).png().toBuffer();
      await expect(normalizeScreenshot(bytes)).rejects.toThrow();
    }
  });
});
