import NextAuth from "next-auth";
import bcrypt from "bcrypt";
import { prisma } from "@/app/src/lib/prisma";
import Credentials from "next-auth/providers/credentials";

// authentication engine
// credentials is the email and password from the form
// authorize is a function that returns a user object or null
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
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
  ],
  callbacks: {
    // JWT is the token that is sent to the client
    // user is the user object that is returned from the authorize function
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // Auth.js validates the authentication state
      // and then reconstructs the session from the token.
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});

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
