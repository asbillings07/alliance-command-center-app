"use client";

import { PASSWORD_RULES } from "@/app/src/lib/auth/passwordPolicy";

export type PasswordRequirementsProps = {
  /** The current password value to evaluate against the policy. */
  password: string;
};

/**
 * PasswordRequirements
 *
 * Renders the full password policy checklist from first paint so users see the
 * requirements up front rather than discovering them through failed submits.
 * Each rule ticks from pending to met as the user types.
 *
 * This shows policy compliance (requirements), not an entropy/strength meter,
 * and is driven by the same PASSWORD_RULES enforced on the server. Met/unmet
 * state is conveyed by an icon and screen-reader text, not color alone.
 */
export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  return (
    <ul aria-live="polite" className="mt-2 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className="flex items-center gap-2 text-sm">
            <RuleIcon met={met} />
            <span className={met ? "text-success" : "text-text-muted"}>
              {rule.label}
            </span>
            <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function RuleIcon({ met }: { met: boolean }) {
  if (met) {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-success"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-text-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
