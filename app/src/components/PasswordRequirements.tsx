import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from "@/app/src/lib/password";

// Single shared encoder: the byte-length check runs on every keystroke, so
// reuse one instance rather than allocating a TextEncoder per call.
const passwordEncoder = new TextEncoder();
const passwordByteLength = (value: string) =>
  passwordEncoder.encode(value).length;

type RequirementStatus = "pending" | "met" | "error";

function RequirementIcon({ status }: { status: RequirementStatus }) {
  if (status === "met") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 0 1.42l-7.5 7.5a1 1 0 0 1-1.42 0l-3.5-3.5a1 1 0 1 1 1.42-1.42l2.79 2.79 6.79-6.79a1 1 0 0 1 1.42 0Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-3.5 w-3.5 shrink-0"
    >
      <circle cx="10" cy="10" r="5" />
    </svg>
  );
}

function Requirement({
  status,
  children,
}: {
  status: RequirementStatus;
  children: React.ReactNode;
}) {
  const tone =
    status === "met"
      ? "text-success"
      : status === "error"
        ? "text-danger"
        : "text-text-muted";
  return (
    <li className={`flex items-center gap-2 ${tone}`}>
      <RequirementIcon status={status} />
      <span>{children}</span>
    </li>
  );
}

/**
 * Live password requirements checklist. Renders the rules up front (neutral) so
 * users know what's expected before typing, then updates as they type so they
 * can confirm the password is acceptable BEFORE submitting rather than
 * discovering it after.
 *
 * It advertises ONLY the rules the app actually enforces (see `password.ts`):
 * a minimum length and confirmation match, plus a "too long" state surfaced
 * only if the bcrypt 72-byte cap is exceeded (virtually no one hits it, so
 * advertising it up front would be noise). Deliberately NO complexity rules
 * (uppercase/number/special) — the policy is length-only.
 *
 * `currentPassword` + `requireDifferent` add an advisory "different from your
 * current password" row for the change-password form; the server remains the
 * authority on reuse.
 */
export function PasswordRequirements({
  password,
  confirm,
  currentPassword,
  requireDifferent = false,
}: {
  password: string;
  confirm: string;
  currentPassword?: string;
  requireDifferent?: boolean;
}) {
  const lengthStatus: RequirementStatus =
    password.length >= PASSWORD_MIN_LENGTH ? "met" : "pending";

  // Advisory only: we can compare against the current password once the user
  // has typed both. It stays neutral otherwise (e.g. browser autofill leaves
  // currentPassword empty), and the server is the authority on reuse.
  const current = currentPassword ?? "";
  const differentStatus: RequirementStatus =
    current.length === 0 || password.length === 0
      ? "pending"
      : password === current
        ? "error"
        : "met";

  const confirmStarted = confirm.length > 0;
  const matchStatus: RequirementStatus = !confirmStarted
    ? "pending"
    : password === confirm
      ? "met"
      : "error";

  const tooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;

  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      <Requirement status={lengthStatus}>
        At least {PASSWORD_MIN_LENGTH} characters
      </Requirement>
      {requireDifferent && (
        <Requirement status={differentStatus}>
          Different from your current password
        </Requirement>
      )}
      <Requirement status={matchStatus}>Passwords match</Requirement>
      {tooLong && (
        <Requirement status="error">Password is too long</Requirement>
      )}
    </ul>
  );
}
