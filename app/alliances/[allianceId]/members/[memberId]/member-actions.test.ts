import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/touchAllianceSetupActivity", () => ({
  touchAllianceSetupActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/src/lib/allianceMemberLock", () => ({
  withAllianceMemberLock: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    allianceMember: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { archiveMember, restoreMember, updateMember } from "./member-actions";

const mockFindFirst = prisma.allianceMember.findFirst as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.allianceMember.update as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const mockWithLock = withAllianceMemberLock as ReturnType<typeof vi.fn>;

const allianceId = "alliance-1";
const memberId = "member-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAllianceAccess).mockResolvedValue({
    permissions: { canManageMembers: true },
  } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("archiveMember", () => {
  it("revalidates the reports index and per-metric route pattern on success", async () => {
    mockFindFirst.mockResolvedValue({ id: memberId, archivedAt: null });

    const result = await archiveMember(buildFormData({ allianceId, memberId }));

    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});

describe("restoreMember", () => {
  it("revalidates the reports index and per-metric route pattern on success", async () => {
    mockWithLock.mockImplementation(
      async (_allianceId: string, fn: (tx: typeof prisma, count: number) => unknown) =>
        fn(prisma, 5),
    );
    mockFindFirst.mockResolvedValue({ id: memberId, archivedAt: new Date() });
    mockUpdate.mockResolvedValue({});

    const result = await restoreMember(buildFormData({ allianceId, memberId }));

    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});

describe("updateMember", () => {
  it("revalidates the reports index and per-metric route pattern on success", async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: memberId, archivedAt: null, playerName: "Old Name" })
      .mockResolvedValueOnce(null);
    mockUpdate.mockResolvedValue({});

    const result = await updateMember(
      buildFormData({ allianceId, memberId, playerName: "New Name" }),
    );

    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});
