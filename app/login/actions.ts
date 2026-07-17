"use server";
import { signIn } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { sanitizeCallbackUrl } from "@/app/src/lib/auth/callbackUrl";

export type LoginState = {
  error: string | null;
};

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString().trim();
  const rawCallbackUrl = formData.get("callbackUrl")?.toString() || "/app";
  const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);

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
