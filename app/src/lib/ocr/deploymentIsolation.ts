import { checkDbIdentity, connectionIdentity, productionIdentities } from "../productionDb";

/** Read-only configuration preflight. Call before Prisma can open a connection. */
export function checkOcrDeploymentIsolation(env: Record<string, string | undefined>): string[] {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "acc-ocr-eval"
    || env.VERCEL_GIT_COMMIT_REF !== "codex/ocr-recognition-trial") {
    return ["OCR deployment preflight requires the dedicated evaluation environment and reviewed branch."];
  }

  // Use independently verified, non-secret endpoint identities. These pins do
  // not prove database permissions or credential freshness; operators verify
  // those separately and preserve the same spending ledger across deployments.
  const expected = env.OCR_EVAL_DB_IDENTITY;
  const shared = env.OCR_EVAL_SHARED_DB_HOSTS;
  if (!expected || !shared?.trim()) {
    return ["OCR deployment requires the verified trial and ordinary-preview database identities."];
  }

  try {
    const expectedIdentities = productionIdentities(expected);
    const sharedIdentities = productionIdentities(shared);
    if (sharedIdentities.length === 0) {
      return ["OCR deployment requires at least one verified ordinary-preview database identity."];
    }
    if (expectedIdentities.length !== 1) {
      return ["OCR_EVAL_DB_IDENTITY must name exactly one verified database identity."];
    }
    const expectedIdentity = expectedIdentities[0];
    const excluded = [...productionIdentities(env.PRODUCTION_DB_HOSTS), ...sharedIdentities];
    const problems = checkDbIdentity(env);
    if (excluded.includes(expectedIdentity)) {
      problems.push("The OCR trial database must be separate from production and ordinary previews.");
    }
    for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
      const value = env[key];
      if (!value) {
        problems.push(`${key} is required for the OCR deployment preflight.`);
        continue;
      }
      const url = new URL(value);
      // PostgreSQL drivers can let query parameters (host, port, etc.) override
      // the URI authority. Accept only the reviewed Neon TLS options so the
      // actual connection cannot silently route around the endpoint check.
      const options = [...url.searchParams.entries()];
      const allowedOptions: Record<string, readonly string[]> = {
        sslmode: ["require", "verify-ca", "verify-full"],
        channel_binding: ["require", "prefer"],
      };
      if (new Set(options.map(([key]) => key)).size !== options.length
        || options.some(([key, option]) => !allowedOptions[key]?.includes(option))) {
        problems.push(`${key} contains unsupported connection options.`);
      }
      if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        problems.push(`${key} must be a PostgreSQL connection.`);
      } else if (connectionIdentity(value) !== expectedIdentity) {
        problems.push(`${key} does not match the verified OCR trial database identity.`);
      }
    }
    return problems;
  } catch {
    // Parsing errors may contain connection strings. Never echo their values.
    return ["OCR database configuration is malformed; no migration may run."];
  }
}
