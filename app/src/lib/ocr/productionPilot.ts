import { checkDbIdentity, connectionIdentity } from "../productionDb";

type Env = Record<string, string | undefined>;

export function productionPilotConfigured(env: Env = process.env) {
  if (env.VERCEL_ENV !== "production" || env.VERCEL_TARGET_ENV !== "production"
    || env.VERCEL_GIT_COMMIT_REF !== "main" || env.OCR_PILOT_ENABLED !== "true"
    || !env.OCR_PILOT_USER_ID?.trim() || !env.OCR_PILOT_ALLIANCE_ID?.trim()
    || !env.DATABASE_URL || !env.DIRECT_URL || checkDbIdentity(env).length) return false;
  return [env.DATABASE_URL, env.DIRECT_URL].every(value => {
    const url = new URL(value);
    return url.protocol === "postgresql:" && connectionIdentity(value) === "ep-broad-pond-auubqyjq"
      && [...url.searchParams].every(([key, option]) =>
        (key === "sslmode" && ["require", "verify-ca", "verify-full"].includes(option))
        || (key === "channel_binding" && ["require", "prefer"].includes(option)));
  });
}
