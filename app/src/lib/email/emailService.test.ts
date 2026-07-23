import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeliverEmailInput } from "./deliverEmail";
import type { EmailResult } from "./types";

const deliverEmailMock = vi.fn<(input: DeliverEmailInput) => Promise<EmailResult>>();

vi.mock("./deliverEmail", () => ({
  deliverEmail: (input: DeliverEmailInput) => deliverEmailMock(input),
}));

import { emailService } from "./emailService";

describe("emailService", () => {
  beforeEach(() => {
    deliverEmailMock.mockReset();
    deliverEmailMock.mockResolvedValue({ status: "sent", messageId: "msg_123" });
  });

  it("sendBetaInvitation includes default replyTo header", async () => {
    const result = await emailService.sendBetaInvitation({
      to: "invitee@example.com",
      invitation: {
        id: "inv_1",
        email: "invitee@example.com",
        inviteUrl: "https://alliancehqapp.com/redeem/token123",
        inviteCode: "ABC-123",
        expiresAt: new Date("2026-12-31"),
      },
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "invitee@example.com",
        replyTo: "support@alliancehq.app",
        metadata: { invitationId: "inv_1" },
      })
    );
  });

  it("sendAccessRequestConfirmation includes default replyTo header", async () => {
    const result = await emailService.sendAccessRequestConfirmation({
      to: "applicant@example.com",
      request: { name: "Commander" },
      accessRequestId: "req_123",
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "applicant@example.com",
        replyTo: "support@alliancehq.app",
        metadata: { accessRequestId: "req_123" },
      })
    );
  });

  it("sendFeedbackNotification includes submitterEmail as replyTo when available", async () => {
    const result = await emailService.sendFeedbackNotification({
      to: "operators@alliancehq.app",
      feedback: {
        referenceId: "fb_123",
        categoryLabel: "General Feedback",
        message: "Great product!",
        submitterEmail: "user@example.com",
        url: "https://alliancehqapp.com",
        submittedAt: new Date("2026-07-01"),
      },
      feedbackId: "row_123",
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "operators@alliancehq.app",
        replyTo: "user@example.com",
        metadata: { feedbackId: "row_123" },
      })
    );
  });

  it("sendEmailChangeVerification includes default replyTo header", async () => {
    const result = await emailService.sendEmailChangeVerification({
      to: "new-email@example.com",
      verification: {
        verifyUrl: "https://alliancehqapp.com/verify?token=abc",
        expiresAt: new Date("2026-12-31"),
      },
      userId: "user_456",
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new-email@example.com",
        replyTo: "support@alliancehq.app",
        metadata: { userId: "user_456" },
      })
    );
  });

  it("sendPasswordReset includes default replyTo header", async () => {
    const result = await emailService.sendPasswordReset({
      to: "user@example.com",
      reset: {
        resetUrl: "https://alliancehqapp.com/reset?token=xyz",
        expiresAt: new Date("2026-12-31"),
      },
      userId: "user_789",
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        replyTo: "support@alliancehq.app",
        metadata: { userId: "user_789" },
      })
    );
  });
});
