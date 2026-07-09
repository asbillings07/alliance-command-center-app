"use server";
import { signIn } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";

export type LoginState = {
  error: string | null;
};

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString().trim();
  const callbackUrl = formData.get("callbackUrl")?.toString() || "/app";

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    console.error("Error signing in", error);
    return { error: "Invalid email or password" };
  }

  redirect(callbackUrl);
}
