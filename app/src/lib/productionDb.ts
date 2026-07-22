/**
 * Production database identity (ADR-016).
 *
 * The single source of truth for "does this connection string point at the
 * production database?", shared by the startup guard in `env.ts` and the beta
 * cleanup script so the app and the tooling can never disagree.
 *
 * A raw hostname comparison is NOT safe with Neon:
 *   - the same branch is reachable via a POOLED host (`ep-x-123-pooler.<region>...`)
 *     and a DIRECT host (`ep-x-123.<region>...`);
 *   - custom domains / aliases can differ again.
 * So we reduce any connection string to its Neon ENDPOINT ID (the `ep-...`
 * label, with the `-pooler` suffix stripped), which is stable across the pooled
 * and direct forms, and compare that against an allowlist of production
 * endpoint identities. Non-Neon hosts fall back to their exact hostname, so the
 * guard still works (just with host-level, not endpoint-level, granularity).
 */

/** Reduce a Postgres connection string to a stable database identity. */
export function connectionIdentity(connectionString: string): string {
  let host: string;
  try {
    host = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new Error("Connection string is not a valid URL");
  }
  const label = host.split(".")[0]; // e.g. ep-cool-name-123456-pooler
  const endpoint = label.replace(/-pooler$/, ""); // e.g. ep-cool-name-123456
  // Neon endpoint ids start with `ep-`; anything else keeps its full host so
  // non-Neon providers still get a deterministic identity.
  return endpoint.startsWith("ep-") ? endpoint : host;
}

/**
 * Parse `PRODUCTION_DB_HOSTS` into a set of production identities. Accepts a
 * comma/whitespace-separated list of either bare Neon endpoint ids (`ep-...`),
 * bare hosts, or full connection strings — each is normalized the same way as
 * a live connection string.
 */
export function productionIdentities(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      // A bare Neon endpoint id has no host separator or scheme; a full host
      // (even one starting with `ep-`) must be reduced via connectionIdentity.
      const isBareEndpoint =
        entry.startsWith("ep-") && !entry.includes(".") && !entry.includes("://");
      if (isBareEndpoint) return entry.replace(/-pooler$/, "");
      const asUrl = entry.includes("://") ? entry : `postgres://${entry}`;
      return connectionIdentity(asUrl);
    });
}

export type DbEnvKind = "production" | "preview" | "other";

/** The subset of the environment this module reads. */
type Env = Record<string, string | undefined>;

/**
 * Which deployment stack are we? Only Vercel Production/Preview are policed;
 * everything else (local dev, CI, tests) is "other" and unconstrained.
 */
export function dbEnvKind(env: Env = process.env): DbEnvKind {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "other";
}

/**
 * The connection-string env vars that can touch the database. `DIRECT_URL` is
 * used by Prisma for migrations when connection pooling is in front of the
 * runtime `DATABASE_URL`; validate it too when present.
 */
const DB_CONNECTION_VARS = ["DATABASE_URL", "DIRECT_URL"] as const;

/**
 * Fail-closed database-isolation check. Returns a list of problems (empty means
 * ok) rather than throwing, so callers decide how to surface them.
 *
 * Policy on Vercel:
 *   - `PRODUCTION_DB_HOSTS` MUST be set (so isolation is a deliberate, provable
 *     configuration, not an implicit default);
 *   - in Production, every configured DB connection string must resolve to a
 *     production identity;
 *   - in Preview, NONE may — a preview build must never touch production data.
 */
export function checkDbIdentity(env: Env = process.env): string[] {
  const kind = dbEnvKind(env);
  if (kind === "other") return [];

  const problems: string[] = [];
  const allow = productionIdentities(env.PRODUCTION_DB_HOSTS);

  if (allow.length === 0) {
    problems.push(
      "PRODUCTION_DB_HOSTS is required on Vercel to prove database isolation (a comma-separated allowlist of production Neon endpoint ids or hosts)."
    );
    return problems;
  }

  for (const name of DB_CONNECTION_VARS) {
    const conn = env[name];
    if (!conn) continue;
    let identity: string;
    try {
      identity = connectionIdentity(conn);
    } catch {
      problems.push(`${name} is not a valid connection string.`);
      continue;
    }
    const pointsAtProduction = allow.includes(identity);
    if (kind === "production" && !pointsAtProduction) {
      problems.push(
        `${name} does not resolve to a known production database identity; production must use a production database.`
      );
    }
    if (kind === "preview" && pointsAtProduction) {
      problems.push(
        `${name} resolves to a PRODUCTION database identity; a Preview deployment must never connect to production data.`
      );
    }
  }

  return problems;
}
