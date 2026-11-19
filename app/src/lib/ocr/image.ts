import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { OCR_MAX_IMAGE_BYTES, OCR_MAX_INPUT_BYTES, OcrEvaluationError } from "./config";

export async function normalizeScreenshot(input: Uint8Array) {
  if (!input.length || input.length > OCR_MAX_INPUT_BYTES) throw new OcrEvaluationError("Choose one PNG or JPEG no larger than 2 MB.");
  try {
    const image = sharp(input, { limitInputPixels: 12_000_000, failOn: "warning", animated: false });
    const metadata = await image.metadata();
    if (!["png", "jpeg"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1
      || !metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 200) {
      throw new Error("Unsupported image");
    }
    // Preserve pixel dimensions and text detail; correct EXIF orientation and
    // discard metadata. Never silently resize a source that OCR must inspect.
    const { data, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
    if (data.length > OCR_MAX_IMAGE_BYTES) throw new OcrEvaluationError("This screenshot is too large after preparation. Use a smaller PNG or JPEG with readable names and scores.");
    return { bytes: data, width: info.width, height: info.height, digest: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof OcrEvaluationError) throw error;
    throw new OcrEvaluationError("We could not read this image. Choose a complete PNG or JPEG screenshot up to 12 megapixels.");
  }
}
