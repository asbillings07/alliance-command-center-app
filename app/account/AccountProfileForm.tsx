"use client";

import { useActionState } from "react";
import { updateProfile, type UpdateProfileState } from "./actions";
import { Button, Input, Label } from "@/app/src/components/client";

const initialState: UpdateProfileState = { status: "idle", message: null };

type AccountProfileFormProps = {
  displayName: string;
  email: string;
};

export function AccountProfileForm({
  displayName,
  email,
}: AccountProfileFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateProfile,
    initialState
  );

  return (
    <form className="space-y-5" action={formAction}>
      {state.status === "success" && state.message && (
        <div className="p-3 bg-success/10 border border-success text-success rounded-md text-sm">
          {state.message}
        </div>
      )}
      {state.status === "error" && state.message && (
        <div className="p-3 bg-danger/10 border border-danger text-danger rounded-md text-sm">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="displayName" required>
          Display Name
        </Label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          required
          disabled={isPending}
          autoComplete="name"
          defaultValue={displayName}
        />
        <p className="mt-2 text-sm text-text-muted">
          The name other leaders see.
        </p>
      </div>

      <div>
        <Label>Sign-in Email</Label>
        <div className="px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-muted">
          {email}
        </div>
        <p className="mt-2 text-sm text-text-muted">
          This email is your account&apos;s sign-in identity and cannot
          currently be changed.
        </p>
      </div>

      <div className="pt-2">
        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
