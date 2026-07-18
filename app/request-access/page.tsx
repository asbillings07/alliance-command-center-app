import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { AuthLayout } from "@/app/src/components";
import { RequestAccessForm } from "./RequestAccessForm";

export const metadata = {
  title: "Request Beta Access - Alliance Command Center",
  description: "Request an invitation to the Alliance Command Center private beta.",
};

export default async function RequestAccessPage() {
  // Authenticated users already have access; send them to the app.
  const session = await auth();
  if (session?.user) {
    redirect("/app");
  }

  return (
    <AuthLayout
      icon={<EnvelopeIcon />}
      title="Request Beta Access"
      subtitle="Alliance Command Center is currently invite-only. Tell us about your alliance and we'll reach out if we can invite you."
    >
      <RequestAccessForm />
    </AuthLayout>
  );
}

function EnvelopeIcon() {
  return (
    <svg
      className="h-8 w-8"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}
