"use server";
import { signIn } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";

export type LoginState = {
  error: string | null;
};

function sanitizeCallbackUrl(url: string): string {
  // Only allow relative paths starting with /
  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return "/app";
  }
  // Reject any URL with a protocol
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return "/app";
    }
  } catch {
    return "/app";
  }
  return url;
}

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
