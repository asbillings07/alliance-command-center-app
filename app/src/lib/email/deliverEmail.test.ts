import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { DeliverEmailRequest, EmailResult } from "./types";

const deliverMock = vi.fn<(req: DeliverEmailRequest) => Promise<EmailResult>>();

vi.mock("./transport", () => ({
  transport: {
    deliver: (req: DeliverEmailRequest) => deliverMock(req),
  },
}));

import { deliverEmail } from "./deliverEmail";

function Sample({ name }: { name: string }) {
  return createElement("p", null, `Hello ${name}`);
}

describe("deliverEmail", () => {
  beforeEach(() => {
    deliverMock.mockReset();
    deliverMock.mockResolvedValue({ status: "sent", messageId: "msg_1" });
  });

  it("renders the component to html + text and forwards to the transport", async () => {
    const result = await deliverEmail({
      to: "user@example.com",
      subject: "Hi",
      react: createElement(Sample, { name: "World" }),
      metadata: { invitationId: "inv_1" },
    });

    expect(result).toEqual({ status: "sent", messageId: "msg_1" });
    expect(deliverMock).toHaveBeenCalledTimes(1);

    const request = deliverMock.mock.calls[0][0];
    expect(request.to).toBe("user@example.com");
    expect(request.subject).toBe("Hi");
    expect(request.metadata).toEqual({ invitationId: "inv_1" });
    expect(request.html).toContain("Hello World");
    expect(request.text).toContain("Hello World");
  });

  it("propagates a skipped status from the transport", async () => {
    deliverMock.mockResolvedValue({ status: "skipped" });

    const result = await deliverEmail({
      to: "user@example.com",
      subject: "Hi",
      react: createElement(Sample, { name: "World" }),
    });

    expect(result.status).toBe("skipped");
  });
});
