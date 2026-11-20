"use server";
import { getRelatedScans } from "@/app/src/lib/platform/importErrors";
export async function loadScanHistory(key: string, snapshot: boolean) {
  return getRelatedScans(key, snapshot);
}
