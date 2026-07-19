import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeedback } from "./feedback";

vi.mock("./prisma", () => ({
  prisma: {
    feedback: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  feedback: {
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createFeedback", () => {
  it("persists feedback, trimming message and url and passing the category through", async () => {
    mockPrisma.feedback.create.mockResolvedValue({ id: "fb_1" });

    await createFeedback({
      userId: "u1",
      category: "BUG",
      message: "  import broke  ",
      url: "  /alliances/a1/periods/p1/import  ",
      userAgent: "Mozilla/5.0",
      viewport: "390x844",
      appVersion: "1.0.0-beta.2",
    });

    expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        category: "BUG",
        message: "import broke",
        url: "/alliances/a1/periods/p1/import",
        userAgent: "Mozilla/5.0",
        viewport: "390x844",
        appVersion: "1.0.0-beta.2",
      },
    });
  });

  it("normalizes blank optional metadata to null", async () => {
    mockPrisma.feedback.create.mockResolvedValue({ id: "fb_2" });

    await createFeedback({
      userId: "u1",
      category: "IDEA",
      message: "nice to have",
      url: "/alliances/a1",
      userAgent: "   ",
      viewport: "",
      appVersion: undefined,
    });

    expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        category: "IDEA",
        message: "nice to have",
        url: "/alliances/a1",
        userAgent: null,
        viewport: null,
        appVersion: null,
      },
    });
  });
});
