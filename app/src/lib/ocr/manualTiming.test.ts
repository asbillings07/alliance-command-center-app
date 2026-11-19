import { afterEach, expect, it, vi } from "vitest";
import { manualTimingIsolated } from "./manualTiming";
vi.mock("../prisma", () => ({ prisma: {} }));
afterEach(() => vi.unstubAllEnvs());

it("admits local timing fixtures only on an unredirected loopback database", () => {
  for (const [key, value] of Object.entries({ VERCEL: "", VERCEL_ENV: "", ACC_E2E_MODE: "1", OCR_EVAL_TEST_FIXTURE: "1" })) vi.stubEnv(key, value);
  for (const url of ["postgresql://ordinary.example/test", "postgresql://localhost/test?host=ordinary.example", ""]) {
    vi.stubEnv("DATABASE_URL", url);
    expect(manualTimingIsolated()).toBe(false);
  }
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1/test");
  expect(manualTimingIsolated()).toBe(true);
});
