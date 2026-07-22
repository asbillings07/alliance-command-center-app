import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AllowlistTransport } from "./allowlistTransport";
import type { DeliverEmailRequest, EmailResult, EmailTransport } from "../types";

function makeInner() {
  const deliver = vi.fn<(req: DeliverEmailRequest) => Promise<EmailResult>>(
    async () => ({ status: "sent", messageId: "msg_1" })
  );
  const transport: EmailTransport = { deliver };
  return { transport, deliver };
}

const base: DeliverEmailRequest = {
  to: "tester@example.com",
  subject: "Hi",
  html: "<p>secret token</p>",
  text: "reset link https://x/reset/secret",
  metadata: { userId: "u1" },
};

describe("AllowlistTransport", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers when the sole recipient is allowlisted (case-insensitive)", async () => {
    const { transport, deliver } = makeInner();
    const t = new AllowlistTransport(transport, ["Tester@Example.com"]);
    const result = await t.deliver(base);
    expect(result.status).toBe("sent");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("skips (does not deliver) when the recipient is not allowlisted", async () => {
    const { transport, deliver } = makeInner();
    const t = new AllowlistTransport(transport, ["someone-else@example.com"]);
    const result = await t.deliver(base);
    expect(result).toEqual({ status: "skipped" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("skips when ANY of several comma-separated recipients is off-list", async () => {
    const { transport, deliver } = makeInner();
    const t = new AllowlistTransport(transport, ["a@example.com"]);
    const result = await t.deliver({
      ...base,
      to: "a@example.com, b@evil.com",
    });
    expect(result.status).toBe("skipped");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers when every comma-separated recipient is allowlisted", async () => {
    const { transport, deliver } = makeInner();
    const t = new AllowlistTransport(transport, ["a@example.com", "b@example.com"]);
    const result = await t.deliver({
      ...base,
      to: "a@example.com, b@example.com",
    });
    expect(result.status).toBe("sent");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("skips an empty recipient list rather than delivering", async () => {
    const { transport, deliver } = makeInner();
    const t = new AllowlistTransport(transport, ["a@example.com"]);
    const result = await t.deliver({ ...base, to: "" });
    expect(result.status).toBe("skipped");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("never logs the message body/token when skipping", async () => {
    const { transport } = makeInner();
    const t = new AllowlistTransport(transport, ["a@example.com"]);
    await t.deliver({ ...base, to: "b@evil.com" });
    const payload = (console.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(payload.text).toBeUndefined();
    expect(payload.html).toBeUndefined();
    expect(payload.metadata).toEqual(base.metadata);
  });
});
