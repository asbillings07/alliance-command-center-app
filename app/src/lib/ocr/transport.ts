import "server-only";
import { localOcrFixtureEnabled } from "./config";
import { googleOcrTransport, type OcrTransport } from "./provider";

export async function evaluationTransport(): Promise<OcrTransport> {
  if (localOcrFixtureEnabled()) {
    const { syntheticOcrTransport } = await import("./testing/syntheticTransport");
    return syntheticOcrTransport();
  }
  return googleOcrTransport();
}
