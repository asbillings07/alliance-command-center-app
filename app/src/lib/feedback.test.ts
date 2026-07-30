import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeedback, resolveFeedbackSubmitterIdentity } from "./feedback";

const mockTransaction = vi.fn();

vi.mock("./prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

const mockTx = {
  user: { findUnique: vi.fn() },
  feedback: { create: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx)
  );
});

describe("createFeedback", () => {
  it("loads submitter identity from User and creates initial FeedbackTriage", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      email: "tester@example.test",
      displayName: "Tester",
    });
    mockTx.feedback.create.mockResolvedValue({
      id: "fb_1",
      userId: "u1",
      submitterEmail: "tester@example.test",
      submitterDisplayName: "Tester",
      category: "BUG",
      message: "import broke",
      url: "/alliances/a1/periods/p1/import",
      userAgent: "Mozilla/5.0",
      viewport: "390x844",
      appVersion: "1.0.0-beta.2",
      allianceId: "a1",
      createdAt: new Date(),
    });

    await createFeedback({
      userId: "u1",
      category: "BUG",
      message: "  import broke  ",
      url: "  /alliances/a1/periods/p1/import  ",
      userAgent: "Mozilla/5.0",
      viewport: "390x844",
      appVersion: "1.0.0-beta.2",
    });

    expect(mockTx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { email: true, displayName: true },
    });
    expect(mockTx.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        submitterEmail: "tester@example.test",
        submitterDisplayName: "Tester",
        category: "BUG",
        message: "import broke",
        url: "/alliances/a1/periods/p1/import",
        userAgent: "Mozilla/5.0",
        viewport: "390x844",
        appVersion: "1.0.0-beta.2",
        allianceId: "a1",
        triage: {
          create: {
            status: "NEW",
            needsResponse: true,
            stateRevision: 0,
          },
        },
      },
    });
  });

  it("populates allianceId via extractFeedbackContext and null when absent", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      email: "tester@example.test",
      displayName: "Tester",
    });
    mockTx.feedback.create.mockResolvedValue({ id: "fb_2" });

    await createFeedback({
      userId: "u1",
      category: "IDEA",
      message: "nice",
      url: "/platform/overview",
    });

    expect(mockTx.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allianceId: null }),
      }),
    );
  });

  it("fails clearly when userId does not resolve", async () => {
    mockTx.user.findUnique.mockResolvedValue(null);

    await expect(
      createFeedback({
        userId: "missing",
        category: "BUG",
        message: "x",
        url: "/",
      }),
    ).rejects.toThrow("user missing not found");
  });

  it("normalizes blank optional metadata to null", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      email: "tester@example.test",
      displayName: "Tester",
    });
    mockTx.feedback.create.mockResolvedValue({ id: "fb_3" });

    await createFeedback({
      userId: "u1",
      category: "IDEA",
      message: "nice to have",
      url: "/alliances/a1",
      userAgent: "   ",
      viewport: "",
      appVersion: undefined,
    });

    expect(mockTx.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userAgent: null,
          viewport: null,
          appVersion: null,
        }),
      }),
    );
  });
});

describe("resolveFeedbackSubmitterIdentity", () => {
  it("prefers submitter snapshot when present", () => {
    expect(
      resolveFeedbackSubmitterIdentity({
        submitterEmail: "snap@example.test",
        submitterDisplayName: "Snapshot Name",
        user: { email: "live@example.test", displayName: "Live Name" },
      }),
    ).toEqual({
      email: "snap@example.test",
      displayName: "Snapshot Name",
    });
  });

  it("falls back to live User when snapshot email is null", () => {
    expect(
      resolveFeedbackSubmitterIdentity({
        submitterEmail: null,
        submitterDisplayName: null,
        user: { email: "live@example.test", displayName: "Live Name" },
      }),
    ).toEqual({
      email: "live@example.test",
      displayName: "Live Name",
    });
  });

  it("returns Unknown submitter when neither snapshot nor user is available", () => {
    expect(
      resolveFeedbackSubmitterIdentity({
        submitterEmail: null,
        submitterDisplayName: null,
        user: null,
      }),
    ).toEqual({
      email: "Unknown submitter",
      displayName: null,
    });
  });
});
