import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveGoogleUser } from "./resolveGoogleUser";
import {
  GoogleAccountMismatchError,
  InvitationRequiredError,
} from "./identity/errors";

// Mock the exact specifiers the implementation imports (the `@/app/src/...`
// alias) so the mocked module IDs always match, regardless of how Vitest
// resolves relative vs. aliased paths.
vi.mock("@/app/src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/app/src/lib/auth/ensureGoogleIdentity", () => ({
  ensureGoogleIdentity: vi.fn(),
}));
vi.mock("@/app/src/lib/auth/provisionOAuthUser", () => ({
  provisionOAuthUser: vi.fn(),
}));
vi.mock("@/app/src/lib/auth/identity/eligibility", () => ({
  isInvitationEligible: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { ensureGoogleIdentity } from "@/app/src/lib/auth/ensureGoogleIdentity";
import { provisionOAuthUser } from "@/app/src/lib/auth/provisionOAuthUser";
import { isInvitationEligible } from "@/app/src/lib/auth/identity/eligibility";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockEnsure = ensureGoogleIdentity as unknown as ReturnType<typeof vi.fn>;
const mockProvision = provisionOAuthUser as unknown as ReturnType<typeof vi.fn>;
const mockEligible = isInvitationEligible as unknown as ReturnType<typeof vi.fn>;

const SUBJECT = "google-sub-1";
const EMAIL = "google-current@gmail.com";

/** Route findUnique to the subject-keyed or email-keyed answer. */
function configure(opts: { bySubject?: any; byEmail?: any } = {}) {
  mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if ("googleSubject" in where) return opts.bySubject ?? null;
    if ("email" in where) return opts.byEmail ?? null;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveGoogleUser", () => {
  it("resolves a returning user by subject and never resyncs email or display name from Google", async () => {
    // The stored account has diverged from Google: the leader changed their
    // email in-app and their display name differs too. Google authenticates
    // identity; it is not the source of profile truth.
    const stored = {
      id: "user-1",
      email: "leader@alliancehq.app",
      displayName: "Leader",
      googleSubject: SUBJECT,
    };
    configure({ bySubject: stored });

    const result = await resolveGoogleUser({
      email: EMAIL,
      googleSubject: SUBJECT,
      displayName: "Different Google Name",
    });

    expect(result).toBe(stored);
    expect(result.email).toBe("leader@alliancehq.app");
    expect(result.displayName).toBe("Leader");
    // Postcondition.
    expect(result.googleSubject).toBe(SUBJECT);

    // No linking, provisioning, or email lookup happened.
    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { googleSubject: SUBJECT },
    });
  });

  it("links the subject to an existing account on first Google sign-in (lazy backfill)", async () => {
    const existing = {
      id: "user-2",
      email: EMAIL,
      displayName: "Existing",
      googleSubject: null,
    };
    configure({ byEmail: existing });
    mockEnsure.mockResolvedValue(undefined);

    const result = await resolveGoogleUser({
      email: EMAIL,
      googleSubject: SUBJECT,
      displayName: "Existing",
    });

    expect(mockEnsure).toHaveBeenCalledWith(existing, SUBJECT);
    expect(mockProvision).not.toHaveBeenCalled();
    // Postcondition holds even though the read row was still unanchored.
    expect(result.googleSubject).toBe(SUBJECT);
    expect(result.id).toBe("user-2");
  });

  it("rejects when the email belongs to an account anchored to a different subject", async () => {
    configure({
      byEmail: {
        id: "user-3",
        email: EMAIL,
        displayName: "Other",
        googleSubject: "some-other-subject",
      },
    });
    mockEnsure.mockRejectedValue(new GoogleAccountMismatchError());

    await expect(
      resolveGoogleUser({
        email: EMAIL,
        googleSubject: SUBJECT,
        displayName: "Other",
      })
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);

    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("provisions a new invitation-eligible user", async () => {
    configure(); // neither subject nor email match
    mockEligible.mockResolvedValue(true);
    const created = {
      id: "user-4",
      email: EMAIL,
      displayName: "New Leader",
      googleSubject: SUBJECT,
    };
    mockProvision.mockResolvedValue(created);
    mockEnsure.mockResolvedValue(undefined);

    const result = await resolveGoogleUser({
      email: EMAIL,
      googleSubject: SUBJECT,
      displayName: "New Leader",
    });

    expect(mockProvision).toHaveBeenCalledWith({
      email: EMAIL,
      googleSubject: SUBJECT,
      displayName: "New Leader",
    });
    // Re-assert the invariant on the provisioned (possibly raced) row.
    expect(mockEnsure).toHaveBeenCalledWith(created, SUBJECT);
    expect(result.googleSubject).toBe(SUBJECT);
  });

  it("rejects an ineligible new email without provisioning", async () => {
    configure();
    mockEligible.mockResolvedValue(false);

    await expect(
      resolveGoogleUser({
        email: EMAIL,
        googleSubject: SUBJECT,
        displayName: "Uninvited",
      })
    ).rejects.toBeInstanceOf(InvitationRequiredError);

    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
