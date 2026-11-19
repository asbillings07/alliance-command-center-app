import { afterEach, expect, it, vi } from "vitest";
import { uploadWithRetry } from "./uploadWithRetry";

const failed = { id: "first", status: "FAILED", retryOnce: true };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows progress, waits two seconds and sends one linked retry even if the service stays unavailable", async () => {
  vi.useFakeTimers();
  const post = vi.fn().mockResolvedValueOnce(Response.json(failed)).mockResolvedValueOnce(Response.json({ ...failed, id: "second" }));
  vi.stubGlobal("fetch", post);
  const onRetry = vi.fn();
  const form = new FormData();
  form.set("requestId", "original");
  const result = uploadWithRetry("/scan", form, { onRetry, cancelled: () => false });
  await vi.advanceTimersByTimeAsync(1999);
  expect(onRetry).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).id).toBe("second");
  expect(post).toHaveBeenCalledTimes(2);
  expect(form.get("retryOf")).toBe("first");
  expect(form.get("requestId")).not.toBe("original");
});

it("stopping while waiting sends no retry", async () => {
  vi.useFakeTimers();
  const post = vi.fn().mockResolvedValue(Response.json(failed));
  vi.stubGlobal("fetch", post);
  let stopped = false;
  const result = uploadWithRetry("/scan", new FormData(), { onRetry: () => { stopped = true; }, cancelled: () => stopped });
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toEqual(failed);
  expect(post).toHaveBeenCalledTimes(1);
});

it("a lost response never triggers another request", async () => {
  const post = vi.fn().mockRejectedValue(new Error("connection lost"));
  vi.stubGlobal("fetch", post);
  await expect(uploadWithRetry("/scan", new FormData(), { onRetry: vi.fn(), cancelled: () => false })).rejects.toThrow("connection lost");
  expect(post).toHaveBeenCalledTimes(1);
});
