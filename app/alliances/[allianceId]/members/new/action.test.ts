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

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { withAllianceMemberLock } from "@/app/src/lib/allianceMemberLock";
import { addMember, restoreMember } from "./action";

const mockWithLock = withAllianceMemberLock as ReturnType<typeof vi.fn>;

const allianceId = "alliance-1";
const memberId = "member-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAllianceAccess).mockResolvedValue({
    permissions: { canManageMembers: true },
  } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("addMember", () => {
  it("revalidates the reports index and per-metric route pattern on success", async () => {
    mockWithLock.mockImplementation(async (_allianceId: string, fn: (tx: unknown, count: number) => unknown) =>
      fn(
        {
          allianceMember: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: memberId }),
          },
        },
        5,
      ),
    );

    const result = await addMember(
      buildFormData({ allianceId, playerName: "New Player" }),
    );

    expect(result).toEqual({ success: true, memberId });
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/members`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});

describe("restoreMember", () => {
  it("revalidates the reports index and per-metric route pattern on success", async () => {
    mockWithLock.mockImplementation(async (_allianceId: string, fn: (tx: unknown, count: number) => unknown) =>
      fn(
        {
          allianceMember: {
            findFirst: vi.fn().mockResolvedValue({ id: memberId, archivedAt: new Date() }),
            update: vi.fn().mockResolvedValue({ id: memberId }),
          },
        },
        5,
      ),
    );

    const result = await restoreMember(buildFormData({ allianceId, memberId }));

    expect(result).toEqual({ success: true, memberId });
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});
