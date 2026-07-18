import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoggingTransport } from "./loggingTransport";

const request = {
  to: "invitee@example.com",
  subject: "You're invited",
  html: "<p>secret token link</p>",
  text: "Redeem at https://app.example.com/redeem/secret-token code ABC-123",
  metadata: { invitationId: "inv_1" },
};

describe("LoggingTransport", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports skipped without sending", async () => {
    const result = await new LoggingTransport().deliver(request);
    expect(result).toEqual({ status: "skipped" });
  });

  it("logs the body outside production (dev/CI visibility)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await new LoggingTransport().deliver(request);

    expect(console.info).toHaveBeenCalledTimes(1);
    const payload = (console.info as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(payload.text).toBe(request.text);
  });

  it("redacts the body in production to avoid leaking invite tokens", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await new LoggingTransport().deliver(request);

    expect(console.warn).toHaveBeenCalledTimes(1);
    const payload = (console.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(payload.text).toBeUndefined();
    expect(payload.to).toBe(request.to);
    expect(payload.metadata).toEqual(request.metadata);
  });
});
