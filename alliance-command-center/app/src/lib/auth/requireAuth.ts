import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";

export type AuthUser = { id: string; email: string };
export async function requireAuth(): Promise<AuthUser> {
  const session = await auth();
  if (!session?.user?.id || !session?.user?.email) {
    redirect("/login");
  }
  return { id: session.user.id, email: session.user.email };
}
