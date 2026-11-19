import "server-only";
import { localOcrFixtureEnabled, ocrPreferencesAvailable } from "./config";
import { checkOcrDeploymentIsolation, isLocalOcrDatabase } from "./deploymentIsolation";

export function isolatedOcrDatabaseAvailable() {
  return ocrPreferencesAvailable() && (localOcrFixtureEnabled()
    ? isLocalOcrDatabase(process.env.DATABASE_URL) : checkOcrDeploymentIsolation(process.env).length === 0);
}

