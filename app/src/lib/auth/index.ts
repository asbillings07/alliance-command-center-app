import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import bcrypt from "bcrypt";
import { prisma } from "@/app/src/lib/prisma";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import {
  assertGoogleSubject,
  assertVerifiedGoogleEmail,
  isGoogleAuthEnabled,
  type GoogleProfile,
} from "@/app/src/lib/auth/identity/google";
import { AuthenticationError } from "@/app/src/lib/auth/identity/errors";
import { resolveGoogleUser } from "@/app/src/lib/auth/resolveGoogleUser";
import {
  clearLinkIntent,
  readLinkIntent,
  setGoogleEmail,
} from "@/app/src/lib/auth/googleConnection";
import { handleGoogleConnect } from "@/app/src/lib/auth/handleGoogleConnect";
import {
  getSessionVersion,
  validateSessionVersion,
} from "@/app/src/lib/auth/session";

// Google is registered only when credentials are configured, so environments
// without OAuth (local, CI) are unaffected.
const providers: NextAuthConfig["providers"] = [
  Credentials({
    async authorize(credentials) {
      try {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Match registration, which normalizes emails (trim + lowercase),
        // so casing/whitespace differences don't block sign-in.
        const email = (credentials.email as string).toLowerCase().trim();

        const user = await prisma.user.findUnique({
          where: {
            email,
          },
        });

        if (!user) {
          return null;
        }

        // Password login is a capability: allowed only if this identity has a
        // password credential. Google-only accounts have no passwordHash.
        if (!user.passwordHash) {
          return null;
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash,
        );
        if (!passwordMatch) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          isPlatformAdmin: user.isPlatformAdmin,
          sessionVersion: user.sessionVersion,
        };
      } catch (error) {
        console.error("Error authorizing user", error); // will be send to logger
        return null;
      }
    },
  }),
];

if (isGoogleAuthEnabled()) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

// authentication engine
// credentials is the email and password from the form
// authorize is a function that returns a user object or null
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    // A pending Google-connect intent is bound to the signed-in user and their
    // session version, but sign-out does not bump sessionVersion. Without this,
    // a stale intent could outlive the session: on a shared device, someone who
    // completes an OAuth flow after the user signs out would link *their* Google
    // account to the signed-out user (#131). Dropping the intent when the
    // session ends closes that window. Fail-open on cleanup errors — never block
    // sign-out over a best-effort cookie deletion.
    async signOut() {
      try {
        await clearLinkIntent();
      } catch (error) {
        console.warn("Failed to clear Google link intent on sign-out", error);
      }
    },
  },
  callbacks: {
    // Google is authentication only. The invitation model remains authoritative
    // for eligibility. Expected denials (unverified email, no invitation) throw
    // typed AuthenticationErrors that we translate into a denial (Auth.js
    // AccessDenied). Unexpected failures (e.g. a database outage) are rethrown
    // so they surface as real errors rather than being masked as a denial.
    async signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return true; // credentials already authorized in authorize()
      }

      const googleProfile = profile as GoogleProfile | undefined;

      // A link-intent cookie means this is an explicit connect (or a fail-closed
      // denial). It must never fall through to a normal sign-in, so it is
      // handled entirely in its own path.
      const intent = await readLinkIntent();
      if (intent.status !== "absent") {
        return handleGoogleConnect(intent, googleProfile);
      }

      try {
        if (!googleProfile) {
          // Unexpected: Google always returns a profile. Throw so this
          // surfaces as an error rather than a TypeError/500 downstream.
          throw new Error("Google sign-in callback received no profile");
        }

        const email = assertVerifiedGoogleEmail(googleProfile);
        const googleSubject = assertGoogleSubject(googleProfile);

        // Resolve by subject first (email is now mutable profile data, #144).
        // resolveGoogleUser links/provisions as needed and guarantees the
        // returned user is anchored to this subject; a mismatch or missing
        // invitation throws and is surfaced as AccessDenied.
        const user = await resolveGoogleUser({
          email,
          googleSubject,
          displayName: googleProfile.name?.trim() || email,
        });

        // Keep the connected-Google-email display metadata current (#131).
        // Display only: this NEVER changes `User.email`. Written only when it
        // actually changed to avoid a needless write on every sign-in.
        if (user.googleEmail !== email) {
          await setGoogleEmail(user.id, email);
        }

        return true;
      } catch (error) {
        if (error instanceof AuthenticationError) {
          console.warn("Google sign-in denied:", error.message);
          return false;
        }
        // Unexpected: don't mask operational issues as an access denial.
        console.error("Unexpected error during Google sign-in", error);
        throw error;
      }
    },
    // Invariant: after authentication, token.sub is always our internal User.id,
    // regardless of provider. For Google, the incoming user.id is the Google
    // subject. signIn runs first and guarantees every successful Google login is
    // anchored by googleSubject (resolveGoogleUser's postcondition), so subject
    // lookup here is authoritative — email is now mutable profile data (#144) and
    // must not be used to resolve identity. If we cannot resolve the user, we
    // throw rather than leave token.sub as the Google subject — a broken
    // invariant would cause downstream authorization/data-loading failures. This
    // branch only runs at initial sign-in (when `account` is present); later
    // requests reuse the token.
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const googleProfile = profile as GoogleProfile | undefined;
        if (!googleProfile) {
          throw new Error("Google jwt callback received no profile");
        }
        const googleSubject = assertGoogleSubject(googleProfile);
        const dbUser = await prisma.user.findUnique({
          where: { googleSubject },
        });
        if (!dbUser) {
          throw new Error(
            "Could not resolve internal user for Google sign-in during token issuance",
          );
        }
        token.sub = dbUser.id;
        token.isPlatformAdmin = dbUser.isPlatformAdmin;
        token.sessionVersion = dbUser.sessionVersion;
        return token;
      }

      if (user) {
        token.sub = user.id as string;
        token.isPlatformAdmin = user.isPlatformAdmin ?? false;
        token.sessionVersion = user.sessionVersion;
        return token;
      }

      // Every later request (no account/user) reuses the token and reaches here.
      //
      // sessionVersion is an authoritative authentication invariant. Unlike UI
      // hints stored in the JWT (e.g. isPlatformAdmin, a sign-in snapshot), it
      // is revalidated against the database on every authenticated request:
      // returning null invalidates the session (Auth.js clears the cookie), so a
      // bumped version immediately signs out all older tokens — and a deleted
      // user (no version) can never validate.
      if (token.sub) {
        const currentVersion = await getSessionVersion(token.sub);
        if (
          currentVersion === null ||
          !validateSessionVersion(token.sessionVersion, currentVersion)
        ) {
          return null;
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Auth.js validates the authentication state
      // and then reconstructs the session from the token.
      if (session.user && token.sub) {
        session.user.id = token.sub as string;
        session.user.isPlatformAdmin = token.isPlatformAdmin ?? false;
      }
      return session;
    },
  },
});

export const getCurrentUserSession = async () => {
  const session = await auth();
  if (!session || !session.user?.id) {
    return null;
  }
  return session;
};

/* 
1. Get Session
2. Extract userId
3. Load Membership
4. Determine Permissions
5. Load Page Data

Login
   ↓
Verify Credentials
   ↓
Create Session
   ↓
Store Session
   ↓
Send Cookie
   ↓
Future Requests
   ↓
Identify User
   ↓
Load Membership
   ↓
Authorize Access
*/
