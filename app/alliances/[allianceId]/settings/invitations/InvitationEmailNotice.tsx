import type { EmailStatus } from "@/app/src/lib/email/types";

export function InvitationEmailNotice({ status }: { status: EmailStatus | "unknown" }) {
  const message = status === "sent"
    ? "Email accepted for delivery. Inbox delivery is not confirmed; you can also share the invitation link or code privately."
    : status === "skipped"
      ? "No email was sent. The invitation is valid; share the link or code privately."
      : "Email delivery could not be confirmed. The invitation is valid; check delivery before resending, or share the link or code privately.";
  return <p role="status" className={`mt-3 rounded-md border p-3 text-sm ${status === "sent" ? "border-success/30 text-success-light" : "border-warning/30 text-warning-light"}`}>{message}</p>;
}
