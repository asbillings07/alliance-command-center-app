import { auth } from "@/app/src/auth";
import { redirect } from "next/navigation";

export async function app() {
  const session = await auth();
  if (!session || !session.user?.id) {
    redirect("/login");
  }
  console.log("Session found", session);

  return {
    userId: session.user.id,
  };
}
