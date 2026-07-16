import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

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
      <Card className="bg-success/10 border-success">
        <Card.Body>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-success"
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
                  <span className="font-medium text-success">
                    Account Connected
                  </span>
                  <Badge variant="success" size="sm">
                    {formatRole(props.membershipRole)}
                  </Badge>
                </div>
                <span className="text-sm text-success/80">{props.email}</span>
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-secondary">
      <Card.Body>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-surface-secondary rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-text-muted"
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
              <span className="font-medium text-primary-light">Not Connected</span>
              <p className="text-sm text-text-secondary">
                No account linked to this member
              </p>
            </div>
          </div>
          {props.canInvite && (
            <Button
              variant="link"
              size="sm"
              href={`/alliances/${props.allianceId}/settings/invitations`}
            >
              Invite →
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
