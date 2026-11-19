import { beforeEach, expect, it, vi } from "vitest";
import { reviewOrSaveBatch } from "./confirmedBatch";

const mock = vi.hoisted(() => ({ read: vi.fn(), transaction: vi.fn(), isolated: vi.fn() }));
vi.mock("./evaluation", () => ({ readEvaluationContent: mock.read, batchWriteContext: vi.fn() }));
vi.mock("./isolatedDatabase", () => ({ isolatedOcrDatabaseAvailable: mock.isolated }));
vi.mock("./transport", () => ({ evaluationTransport: async () => ({}) }));
vi.mock("../prisma", () => ({ prisma: { $transaction: mock.transaction } }));
const selection = { allianceId:"qa", periodId:"period", attemptIds:["one"], excluded:[], week:"2026-11-16", captureDate:"2026-11-16", dailyMetric:"metric", weeklyMetric:"" };
beforeEach(() => { vi.resetAllMocks(); mock.isolated.mockReturnValue(true); });

it("prevents live Duel snapshots from becoming unqualified canonical scores", async () => {
  mock.read.mockResolvedValue({ contextChanged:false, batchReview:{context:{kind:"today"}, countdown:"20:00:00",rows:[{}]} });
  await expect(reviewOrSaveBatch("actor",selection,{comparison:"test",lowerConfirmed:true})).rejects.toThrow("in-progress");
  expect(mock.transaction).not.toHaveBeenCalled();
});
it("stops before reading sources outside the isolated database", async () => {
  mock.isolated.mockReturnValue(false);
  await expect(reviewOrSaveBatch("actor",selection)).rejects.toThrow("unavailable here");
  expect(mock.read).not.toHaveBeenCalled();
});
