import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import bcrypt from "bcrypt";
import { prisma } from "@/app/src/lib/prisma";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import {
  assertVerifiedGoogleEmail,
  isGoogleAuthEnabled,
  type GoogleProfile,
} from "@/app/src/lib/auth/identity/google";
import { isInvitationEligible } from "@/app/src/lib/auth/identity/eligibility";
import { InvitationRequiredError } from "@/app/src/lib/auth/identity/errors";
import { provisionOAuthUser } from "@/app/src/lib/auth/provisionOAuthUser";

// Google is registered only when credentials are configured, so environments
// without OAuth (local, CI) are unaffected. Auth.js auto-reads AUTH_GOOGLE_ID
// and AUTH_GOOGLE_SECRET.
const providers: NextAuthConfig["providers"] = [
  Credentials({
    async authorize(credentials) {
      try {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email as string,
          },
        });

        if (!user) {
          return null;
        }

        // OAuth-only accounts cannot sign in with a password.
        if (user.authProvider !== "PASSWORD" || !user.passwordHash) {
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
        };
      } catch (error) {
        console.error("Error authorizing user", error); // will be send to logger
        return null;
      }
    },
  }),
];

if (isGoogleAuthEnabled()) {
  providers.push(Google);
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
  callbacks: {
    // Google is authentication only. The invitation model remains authoritative
    // for eligibility. Failures throw typed errors, which we translate to a
    // denial (Auth.js AccessDenied).
    async signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return true; // credentials already authorized in authorize()
      }

      try {
        const email = assertVerifiedGoogleEmail(profile as GoogleProfile);

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          return true;
        }

        if (!(await isInvitationEligible(email))) {
          throw new InvitationRequiredError();
        }

        await provisionOAuthUser({
          email,
          displayName: (profile as GoogleProfile).name?.trim() || email,
          provider: "GOOGLE",
        });

        return true;
      } catch (error) {
        console.error("Google sign-in denied", error);
        return false;
      }
    },
    // Invariant: after authentication, token.sub is always our internal User.id,
    // regardless of provider. For Google, the incoming user.id is the Google
    // subject, so we resolve our cuid by verified email.
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const email = (profile as GoogleProfile | undefined)?.email
          ?.toLowerCase()
          .trim();
        if (email) {
          const dbUser = await prisma.user.findUnique({ where: { email } });
          if (dbUser) {
            token.sub = dbUser.id;
          }
        }
      } else if (user) {
        token.sub = user.id as string;
      }
      return token;
    },
    async session({ session, token }) {
      // Auth.js validates the authentication state
      // and then reconstructs the session from the token.
      if (session.user && token.sub) {
        session.user.id = token.sub as string;
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
