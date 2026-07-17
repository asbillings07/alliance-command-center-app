import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { BetaInvitationView } from "../types";

const SUPPORT_EMAIL = process.env.EMAIL_FROM || "support@alliancehq.app";

function formatExpiration(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Beta invitation email. Takes a single invitation view model so the template
 * is independent of where the values originated and can grow (inviter name,
 * campaign, custom message) without changing call sites.
 */
export function BetaInvitationEmail({
  invitation,
}: {
  invitation: BetaInvitationView;
}) {
  const expires = formatExpiration(invitation.expiresAt);

  return (
    <Html>
      <Head />
      <Preview>You&apos;re invited to the Alliance Command Center beta</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Alliance Command Center</Heading>

          <Text style={paragraph}>Hi,</Text>
          <Text style={paragraph}>
            You&apos;ve been invited to the Alliance Command Center beta - the
            operating system for alliance leadership. Click below to accept your
            invitation and set up your alliance workspace.
          </Text>

          <Section style={buttonSection}>
            <Button style={button} href={invitation.inviteUrl}>
              Accept Invitation
            </Button>
          </Section>

          <Text style={mutedParagraph}>
            Or paste this link into your browser:
          </Text>
          <Link href={invitation.inviteUrl} style={link}>
            {invitation.inviteUrl}
          </Link>

          <Text style={mutedParagraph}>
            Prefer to enter a code? Use this invitation code at the redeem page:
          </Text>
          <Text style={code}>{invitation.inviteCode}</Text>

          <Hr style={hr} />

          <Text style={footnote}>
            This invitation expires on {expires}.
          </Text>
          <Text style={footnote}>
            Questions? Contact us at{" "}
            <Link href={`mailto:${SUPPORT_EMAIL}`} style={link}>
              {SUPPORT_EMAIL}
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default BetaInvitationEmail;

const body: React.CSSProperties = {
  backgroundColor: "#0F172A",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "24px 0",
};

const container: React.CSSProperties = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "480px",
  padding: "32px",
};

const heading: React.CSSProperties = {
  color: "#F9FAFB",
  fontSize: "22px",
  fontWeight: 700,
  margin: "0 0 24px",
  textAlign: "center",
};

const paragraph: React.CSSProperties = {
  color: "#E5E7EB",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

const mutedParagraph: React.CSSProperties = {
  color: "#9CA3AF",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "16px 0 4px",
};

const buttonSection: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const button: React.CSSProperties = {
  backgroundColor: "#3B82F6",
  borderRadius: "6px",
  color: "#FFFFFF",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 24px",
  textDecoration: "none",
};

const link: React.CSSProperties = {
  color: "#60A5FA",
  fontSize: "13px",
  wordBreak: "break-all",
};

const code: React.CSSProperties = {
  color: "#F9FAFB",
  fontSize: "20px",
  fontWeight: 700,
  letterSpacing: "2px",
  margin: "4px 0 0",
};

const hr: React.CSSProperties = {
  borderColor: "#374151",
  margin: "24px 0",
};

const footnote: React.CSSProperties = {
  color: "#9CA3AF",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 4px",
};
