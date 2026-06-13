import { auth } from "@/app/src/lib/auth";
import { User } from "@/app/generated/prisma/client";

export async function requireAuth(): Promise<User> {
  const session = await auth();
  if (!session || !session.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user as User;
}
