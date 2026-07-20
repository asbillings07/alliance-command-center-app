import type { DefaultSession } from "next-auth";

/**
 * Module augmentation for Auth.js.
 *
 * `isPlatformAdmin` is carried on the JWT/session as a lightweight *hint*,
 * captured at sign-in, so per-request routing (e.g. getPostLoginRedirect) can
 * avoid an extra DB lookup. It is NOT authoritative: protected /platform/*
 * routes always re-check the database via requirePlatformAdmin, so a hint that
 * goes stale (admin granted/revoked mid-session) can never grant real access.
 *
 * `sessionVersion` is the opposite: an authoritative authentication invariant.
 * It is stamped on the JWT at sign-in and revalidated against the database on
 * every authenticated request (see the jwt callback), so bumping the stored
 * version immediately rejects all older tokens. It is intentionally NOT exposed
 * on Session — only the auth layer needs it.
 */
declare module "next-auth" {
  interface User {
    isPlatformAdmin?: boolean;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      isPlatformAdmin: boolean;
    } & DefaultSession["user"];
  }
}

// v5 resolves the callback token type from @auth/core/jwt, so augment there
// (augmenting "next-auth/jwt" alone does not merge with the callback's JWT).
declare module "@auth/core/jwt" {
  interface JWT {
    isPlatformAdmin?: boolean;
    sessionVersion?: number;
  }
}
