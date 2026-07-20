"use client";

import { useActionState } from "react";
import { Button } from "@/app/src/components/client";
import {
  confirmEmailChange,
  type ConfirmEmailChangeState,
} from "./action";

const initialState: ConfirmEmailChangeState = {
  status: "idle",
  message: null,
};

type ConfirmEmailChangeFormProps = {
  token: string;
  newEmail: string;
};

export function ConfirmEmailChangeForm({
  token,
  newEmail,
}: ConfirmEmailChangeFormProps) {
  const [state, formAction, isPending] = useActionState(
    confirmEmailChange,
    initialState
  );

  if (state.status === "success") {
    return (
      <div className="text-center">
        <p className="text-text-primary mb-2">
          Your sign-in email is now{" "}
          <span className="font-semibold">{state.newEmail ?? newEmail}</span>.
        </p>
        <p className="text-text-muted text-sm mb-6">
          For your security, you were signed out everywhere. Please sign in
          again with your new email.
        </p>
        <Button href="/login" variant="primary">
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-5" action={formAction}>
      {state.status === "error" && state.message && (
        <div className="p-3 bg-danger/10 border border-danger text-danger rounded-md text-sm">
          {state.message}
        </div>
      )}

      <p className="text-text-muted text-sm">
        Confirm that you want your Alliance Command Center sign-in email changed
        to{" "}
        <span className="font-semibold text-text-primary break-all">
          {newEmail}
        </span>
        . You&apos;ll be signed out everywhere and need to sign in again for
        security.
      </p>

      <input type="hidden" name="token" value={token} />

      <Button type="submit" variant="primary" fullWidth loading={isPending}>
        {isPending ? "Confirming..." : "Confirm new email"}
      </Button>
    </form>
  );
}
