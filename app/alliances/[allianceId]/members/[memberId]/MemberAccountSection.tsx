import Link from "next/link";

type MemberAccountSectionProps = {
  allianceId: string;
  canInvite: boolean;
} & (
  | {
      connected: true;
      email: string;
      membershipRole: string;
    }
  | {
      connected: false;
    }
);

function formatRole(role: string): string {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "LEADER":
      return "Leader";
    case "VIEWER":
      return "Viewer";
    default:
      return role;
  }
}

export function MemberAccountSection(props: MemberAccountSectionProps) {
  if (props.connected) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-green-800">
                  Account Connected
                </span>
                <span className="px-2 py-0.5 bg-green-200 text-green-800 text-xs rounded-full">
                  {formatRole(props.membershipRole)}
                </span>
              </div>
              <span className="text-sm text-green-600">{props.email}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <div>
            <span className="font-medium text-gray-700">Not Connected</span>
            <p className="text-sm text-gray-500">
              No account linked to this member
            </p>
          </div>
        </div>
        {props.canInvite && (
          <Link
            href={`/alliances/${props.allianceId}/settings/invitations`}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Invite →
          </Link>
        )}
      </div>
    </div>
  );
}
