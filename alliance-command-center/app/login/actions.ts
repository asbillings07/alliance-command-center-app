"use server";
import { signIn } from "@/app/src/auth";
import { redirect } from "next/navigation";

export type LoginState = {
  error: string | null;
};

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  //1. Extract email/password
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();
  // 2. Validate inputs
  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  //3. Call signIn()
  try {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result && result.error && result.error.message) {
      return { error: "Invalid email or password" };
    }
  } catch (error) {
    console.error("Error signing in", error);
    return { error: "Invalid email or password" };
  }

  // 5. Redirect to /app
  redirect("/app");
}
