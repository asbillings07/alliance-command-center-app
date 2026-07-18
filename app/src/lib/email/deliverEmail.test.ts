import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeliverEmailRequest, EmailResult } from "./types";

const deliverMock = vi.fn<(req: DeliverEmailRequest) => Promise<EmailResult>>();

vi.mock("./transport", () => ({
  transport: {
    deliver: (req: DeliverEmailRequest) => deliverMock(req),
  },
}));

import { deliverEmail } from "./deliverEmail";

const content = { html: "<p>Hello World</p>", text: "Hello World" };

describe("deliverEmail", () => {
  beforeEach(() => {
    deliverMock.mockReset();
    deliverMock.mockResolvedValue({ status: "sent", messageId: "msg_1" });
  });

  it("forwards the rendered content to the transport", async () => {
    const result = await deliverEmail({
      to: "user@example.com",
      subject: "Hi",
      content,
      metadata: { invitationId: "inv_1" },
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_1" });
    expect(deliverMock).toHaveBeenCalledTimes(1);

    const request = deliverMock.mock.calls[0][0];
    expect(request.to).toBe("user@example.com");
    expect(request.subject).toBe("Hi");
    expect(request.metadata).toEqual({ invitationId: "inv_1" });
    expect(request.html).toBe(content.html);
    expect(request.text).toBe(content.text);
  });

  it("propagates a skipped status from the transport", async () => {
    deliverMock.mockResolvedValue({ status: "skipped" });

    const result = await deliverEmail({
      to: "user@example.com",
      subject: "Hi",
      content,
    });

    expect(result.status).toBe("skipped");
  });

  it("returns failed (does not throw) when the transport throws unexpectedly", async () => {
    deliverMock.mockRejectedValue(new Error("transport exploded"));

    const result = await deliverEmail({
      to: "user@example.com",
      subject: "Hi",
      content,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("transport exploded");
  });
});
