"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label } from "@/app/src/components/client";
import {
  createInvitationAction,
  type CreateInvitationResult,
} from "./actions";

type CopyState = "idle" | "copied";

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="px-3 py-1 text-sm bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg transition-colors"
    >
      {state === "copied" ? "Copied!" : label}
    </button>
  );
}

function SuccessCard({
  email,
  inviteCode,
  inviteUrl,
  onReset,
}: {
  email: string;
  inviteCode: string;
  inviteUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="bg-success/5 border border-success/20 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-success mb-4">
        Invitation Created
      </h3>

      <div className="space-y-4">
        <div>
          <div className="text-sm text-text-muted mb-1">Email</div>
          <div className="text-text-primary">{email}</div>
        </div>

        <div>
          <div className="text-sm text-text-muted mb-1">Invite Code</div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-mono font-bold text-text-primary tracking-wider">
              {inviteCode}
            </span>
            <CopyButton value={inviteCode} label="Copy Code" />
          </div>
        </div>

        <div>
          <div className="text-sm text-text-muted mb-1">Invite Link</div>
          <div className="flex items-center gap-3">
            <code className="text-sm text-text-secondary break-all flex-1 bg-surface-secondary px-2 py-1 rounded">
              {inviteUrl}
            </code>
            <CopyButton value={inviteUrl} label="Copy Link" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button type="button" variant="secondary" onClick={onReset}>
          Invite Another
        </Button>
      </div>
    </div>
  );
}

export function InviteBetaTester() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateInvitationResult | null>(null);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const response = await createInvitationAction(email, notes || undefined);
      setResult(response);

      if (response.success) {
        setEmail("");
        setNotes("");
      }
    });
  };

  const handleReset = () => {
    setResult(null);
  };

  if (result?.success) {
    return (
      <SuccessCard
        email={result.email}
        inviteCode={result.inviteCode}
        inviteUrl={result.inviteUrl}
        onReset={handleReset}
      />
    );
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-6">
      <h2 className="text-lg font-semibold text-text-secondary mb-4">
        Invite Beta Tester
      </h2>

      {result?.success === false && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg">
          <p className="text-sm text-danger">{result.error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isPending}
            placeholder="founder@example.com"
          />
        </div>

        <div>
          <Label htmlFor="notes">
            Notes{" "}
            <span className="text-text-muted font-normal">(optional)</span>
          </Label>
          <Input
            id="notes"
            name="notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
            placeholder="e.g., Met at conference, Alliance: DAY1"
          />
        </div>

        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? "Creating..." : "Create Invitation"}
        </Button>
      </form>
    </div>
  );
}
