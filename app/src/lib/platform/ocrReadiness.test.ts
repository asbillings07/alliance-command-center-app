import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOcrReadiness } from "./ocrReadiness";

const mocks = vi.hoisted(() => ({
  fixture: vi.fn(), isolation: vi.fn(), admin: vi.fn(), available: vi.fn(), aggregate: vi.fn(), retries: vi.fn(),
  statuses: vi.fn(), budget: vi.fn(), transaction: vi.fn(),
}));
vi.mock("../auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: mocks.admin }));
vi.mock("../ocr/config", () => ({ OCR_CAMPAIGN: "fixture", localOcrFixtureEnabled: mocks.fixture, ocrPreferencesAvailable: mocks.available }));
vi.mock("../ocr/deploymentIsolation", () => ({ checkOcrDeploymentIsolation: mocks.isolation }));
vi.mock("next/navigation", () => ({ notFound() { throw new Error("unavailable"); } }));
vi.mock("./qaManualTimingSummary", () => ({ qaManualTimingSummary: () => Promise.resolve([]) }));
vi.mock("../prisma", () => ({ prisma: {
  ocrEvaluationAttempt: { aggregate: mocks.aggregate, count: mocks.retries, groupBy: mocks.statuses },
  ocrEvaluationBudget: { findUnique: mocks.budget }, $transaction: mocks.transaction,
} }));

describe("Platform OCR evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.available.mockReturnValue(true);
    mocks.isolation.mockReturnValue([]);
    mocks.transaction.mockImplementation((queries: unknown[]) => Promise.all(queries));
  });
  it("reads only aggregate scan diagnostics and keeps retries in the attempt denominator", async () => {
    const date = new Date("2026-11-18");
    mocks.aggregate.mockResolvedValue({ _count: 3, _min: { createdAt: date }, _max: { createdAt: date } });
    mocks.retries.mockResolvedValue(1);
    mocks.statuses.mockResolvedValue([{ status: "FAILED", _count: { _all: 1 } }, { status: "READY", _count: { _all: 2 } }]);
    mocks.budget.mockResolvedValue({ reservedMicros: 30000 });
    expect(await getOcrReadiness()).toEqual({ timings: [], attempts: 3, firstAttempts: 2, retries: 1, failed: 1, processing: 0, ready: 2, firstAt: date, lastAt: date, reservedMicros: 30000 });
    expect(mocks.aggregate).toHaveBeenCalledWith({ _count: true, _min: { createdAt: true }, _max: { createdAt: true } });
    expect(mocks.statuses).toHaveBeenCalledWith({ by: ["status"], _count: { _all: true } });
    expect(mocks.retries).toHaveBeenCalledWith({ where: { retryOf: { not: null } } });
    expect(mocks.budget).toHaveBeenCalledWith({ where: { id: "fixture" }, select: { reservedMicros: true } });
  });
  it("preserves missing ledger and empty observation dates", async () => {
    mocks.aggregate.mockResolvedValue({ _count: 0, _min: { createdAt: null }, _max: { createdAt: null } });
    mocks.retries.mockResolvedValue(0);
    mocks.statuses.mockResolvedValue([]);
    mocks.budget.mockResolvedValue(null);
    expect(await getOcrReadiness()).toMatchObject({ attempts: 0, firstAt: null, lastAt: null, reservedMicros: null });
  });
  it("denies non-admins and non-evaluation deployments before reading evidence", async () => {
    mocks.admin.mockRejectedValueOnce(new Error("denied"));
    await expect(getOcrReadiness()).rejects.toThrow("denied");
    mocks.available.mockReturnValue(false);
    await expect(getOcrReadiness()).rejects.toThrow("unavailable");
    mocks.available.mockReturnValue(true);
    mocks.isolation.mockReturnValue(["wrong database"]);
    await expect(getOcrReadiness()).rejects.toThrow("unavailable");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });
});
