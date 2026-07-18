/**
 * Whether transactional email is configured for this deployment.
 *
 * Enabled only when BOTH the API key and sender address are present, mirroring
 * the Google OAuth gate. When disabled, the app logs emails instead of sending
 * (see LoggingTransport), so local/CI environments work without a provider.
 */
export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
