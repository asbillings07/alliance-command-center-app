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
 *
 * Endpoint-id extraction is scoped to VERIFIED Neon hosts (`*.neon.tech`) only.
 * A host is never trusted just because its first label happens to start with
 * `ep-` — e.g. `ep-prod-123.example.com` must NOT collapse to the same
 * identity as the real `ep-prod-123.us-east-2.aws.neon.tech`. Any host outside
 * `.neon.tech` keeps its full, exact hostname as its identity.
 */

const NEON_DOMAIN_SUFFIX = ".neon.tech";

/** Reduce a Postgres connection string to a stable database identity. */
export function connectionIdentity(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Connection string is not a valid URL");
  }
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(NEON_DOMAIN_SUFFIX)) {
    // Neon endpoint ids are stable regardless of port, but a non-Neon host is
    // identified by hostname alone unless we also keep the port — otherwise
    // two distinct instances sharing a hostname on different ports would
    // collapse to the same identity, weakening the isolation guard.
    return url.port ? `${host}:${url.port}` : host;
  }
  const label = host.split(".")[0]; // e.g. ep-cool-name-123456-pooler
  return label.replace(/-pooler$/, ""); // e.g. ep-cool-name-123456
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
      const lower = entry.toLowerCase();
      // A bare Neon endpoint id has no host separator, port, scheme, or path —
      // anything else (a full host, `host:port`, or a URL) must be reduced via
      // connectionIdentity so it is normalized the same way as a live
      // connection string.
      const isBareEndpoint =
        lower.startsWith("ep-") &&
        !lower.includes(".") &&
        !lower.includes(":") &&
        !lower.includes("/");
      if (isBareEndpoint) return lower.replace(/-pooler$/, "");
      const asUrl = lower.includes("://") ? lower : `postgres://${lower}`;
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
