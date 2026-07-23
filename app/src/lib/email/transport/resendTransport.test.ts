import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { ResendTransport } from "./resendTransport";

const request = {
  to: "invitee@example.com",
  subject: "You're invited",
  html: "<p>hi</p>",
  text: "hi",
};

describe("ResendTransport", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("returns sent with the provider messageId on success", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const transport = new ResendTransport("re_test", "noreply@example.com");
    const result = await transport.deliver(request);

    expect(result).toEqual({ status: "sent", messageId: "msg_123" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@example.com",
        to: request.to,
        subject: request.subject,
      })
    );
  });

  it("passes replyTo header to Resend send method", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const transport = new ResendTransport("re_test", "noreply@example.com");
    await transport.deliver({ ...request, replyTo: "support@alliancehq.app" });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@example.com",
        to: request.to,
        subject: request.subject,
        replyTo: "support@alliancehq.app",
      })
    );
  });

  it("returns failed when the provider reports an error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "domain not verified" },
    });

    const transport = new ResendTransport("re_test", "noreply@example.com");
    const result = await transport.deliver(request);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("domain not verified");
  });

  it("returns failed (does not throw) when the send rejects", async () => {
    sendMock.mockRejectedValue(new Error("network down"));

    const transport = new ResendTransport("re_test", "noreply@example.com");
    const result = await transport.deliver(request);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("network down");
  });
});
