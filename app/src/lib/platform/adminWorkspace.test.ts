import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prisma", () => ({
  prisma: {
    allianceMembership: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../prisma";
import { getAdminAllianceWorkspaceDestination } from "./adminWorkspace";

const mockFindMany = prisma.allianceMembership.findMany as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAdminAllianceWorkspaceDestination", () => {
  it("returns none when the user has zero memberships", async () => {
    mockFindMany.mockResolvedValue([]);

    await expect(
      getAdminAllianceWorkspaceDestination("user-1")
    ).resolves.toEqual({ kind: "none" });
  });

  it("returns single with correct href and alliance name for one membership", async () => {
    mockFindMany.mockResolvedValue([
      {
        allianceId: "alliance-1",
        alliance: { name: "Test Alliance" },
      },
    ]);

    await expect(
      getAdminAllianceWorkspaceDestination("user-1")
    ).resolves.toEqual({
      kind: "single",
      allianceId: "alliance-1",
      allianceName: "Test Alliance",
      href: "/alliances/alliance-1",
    });
  });

  it("returns multiple with correct href and count for two or more memberships", async () => {
    mockFindMany.mockResolvedValue([
      {
        allianceId: "alliance-1",
        alliance: { name: "Alliance One" },
      },
      {
        allianceId: "alliance-2",
        alliance: { name: "Alliance Two" },
      },
      {
        allianceId: "alliance-3",
        alliance: { name: "Alliance Three" },
      },
    ]);

    await expect(
      getAdminAllianceWorkspaceDestination("user-1")
    ).resolves.toEqual({
      kind: "multiple",
      count: 3,
      href: "/alliances/select_alliance",
    });
  });

  it("propagates database errors instead of collapsing to none", async () => {
    const dbError = new Error("Database connection failed");
    mockFindMany.mockRejectedValue(dbError);

    await expect(
      getAdminAllianceWorkspaceDestination("user-1")
    ).rejects.toThrow("Database connection failed");
  });
});
