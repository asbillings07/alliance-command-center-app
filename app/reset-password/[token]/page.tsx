import Link from "next/link";
import { AuthLayout } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { isValidPasswordResetToken } from "@/app/src/lib/passwordReset";
import { ResetPasswordForm } from "./ResetPasswordForm";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function ResetPasswordPage({ params }: PageProps) {
  const { token } = await params;
  const valid = await isValidPasswordResetToken(token);

  if (!valid) {
    return (
      <AuthLayout
        title="Reset link invalid"
        subtitle="This password reset link is invalid or has expired."
      >
        <div className="space-y-3">
          <Button variant="primary" fullWidth href="/forgot-password">
            Request a new link
          </Button>
          <Button variant="ghost" fullWidth href="/login">
            Back to Login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a new password for your account."
      footer={
        <p>
          Remembered it?{" "}
          <Link
            href="/login"
            className="text-primary hover:text-primary-hover underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthLayout>
  );
}
