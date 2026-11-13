import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/src/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@/app/src/lib/passwordReset", () => ({ createPasswordResetToken: vi.fn() }));
vi.mock("@/app/src/lib/email", () => ({ emailService: { sendPasswordReset: vi.fn() } }));
vi.mock("@/app/src/lib/appUrl", () => ({ getResetPasswordUrl: (token: string) => `https://example.com/reset-password/${token}` }));
import { prisma } from "@/app/src/lib/prisma";
import { createPasswordResetToken } from "@/app/src/lib/passwordReset";
import { emailService } from "@/app/src/lib/email";
import { requestPasswordReset } from "./actions";

const response = { submitted: true, error: null };
function request() { const form = new FormData(); form.set("email", " OWNER@example.com "); return requestPasswordReset({ submitted: false, error: null }, form); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", email: "owner@example.com", passwordHash: "private-hash" } as Awaited<ReturnType<typeof prisma.user.findUnique>>);
  vi.mocked(createPasswordResetToken).mockResolvedValue({ created: true, rawToken: "private-reset-token", expiresAt: new Date("2026-12-01") });
  vi.mocked(emailService.sendPasswordReset).mockResolvedValue({ status: "sent", messageId: "provider-1" });
});
describe("forgot password delivery diagnostics", () => {
  it.each(["sent", "failed", "skipped"] as const)("records %s while keeping the generic public response", async (status) => {
    vi.mocked(emailService.sendPasswordReset).mockResolvedValue({ status, messageId: status === "sent" ? "provider-1" : undefined });
    expect(await request()).toEqual(response);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "owner@example.com" } });
    expect(emailService.sendPasswordReset).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith("[password-reset] Email outcome", expect.objectContaining({ status }));
    const log = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(log).not.toMatch(/owner@example|private-reset-token|private-hash/);
  });
  it.each([null, { id: "google-1", passwordHash: null }])("does not send to an unknown or Google-only account", async (user) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as Awaited<ReturnType<typeof prisma.user.findUnique>>);
    expect(await request()).toEqual(response);
    expect(createPasswordResetToken).not.toHaveBeenCalled();
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });
  it("does not send a second email when a concurrent request owns token issuance", async () => {
    vi.mocked(createPasswordResetToken).mockResolvedValue({ created: false });
    expect(await request()).toEqual(response);
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });
  it("identifies a token creation failure without logging the raw exception", async () => {
    vi.mocked(createPasswordResetToken).mockRejectedValue(Object.assign(new Error("private token URL and credentials"), { code: "P2010" }));
    expect(await request()).toEqual(response);
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[password-reset] Request failed", expect.objectContaining({ phase: "token_creation", code: "P2010" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private");
  });
});
