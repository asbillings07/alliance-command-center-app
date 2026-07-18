import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAccessRequest } from "./accessRequest";

vi.mock("./prisma", () => ({
  prisma: {
    accessRequest: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  accessRequest: {
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAccessRequest", () => {
  it("persists a request, trimming name and lowercasing email", async () => {
    mockPrisma.accessRequest.create.mockResolvedValue({
      id: "req_1",
      name: "Jane",
      email: "jane@example.com",
      allianceName: "ABC",
      message: "interested",
      createdAt: new Date(),
    });

    await createAccessRequest({
      name: "  Jane  ",
      email: "  Jane@Example.com  ",
      allianceName: "ABC",
      message: "interested",
    });

    expect(mockPrisma.accessRequest.create).toHaveBeenCalledWith({
      data: {
        name: "Jane",
        email: "jane@example.com",
        allianceName: "ABC",
        message: "interested",
      },
    });
  });

  it("normalizes blank optional fields to null", async () => {
    mockPrisma.accessRequest.create.mockResolvedValue({
      id: "req_2",
      name: "Jane",
      email: "jane@example.com",
      allianceName: null,
      message: null,
      createdAt: new Date(),
    });

    await createAccessRequest({
      name: "Jane",
      email: "jane@example.com",
      allianceName: "   ",
      message: "",
    });

    expect(mockPrisma.accessRequest.create).toHaveBeenCalledWith({
      data: {
        name: "Jane",
        email: "jane@example.com",
        allianceName: null,
        message: null,
      },
    });
  });

  it("handles omitted optional fields", async () => {
    mockPrisma.accessRequest.create.mockResolvedValue({
      id: "req_3",
      name: "Jane",
      email: "jane@example.com",
      allianceName: null,
      message: null,
      createdAt: new Date(),
    });

    await createAccessRequest({ name: "Jane", email: "jane@example.com" });

    expect(mockPrisma.accessRequest.create).toHaveBeenCalledWith({
      data: {
        name: "Jane",
        email: "jane@example.com",
        allianceName: null,
        message: null,
      },
    });
  });
});
