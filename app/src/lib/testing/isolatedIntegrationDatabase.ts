import { execSync } from "node:child_process";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

export type IsolatedIntegrationDatabase = {
  prisma: PrismaClient;
  databaseName: string;
  connectionString: string;
  dispose: () => Promise<void>;
};

function adminConnectionString(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

function isolatedConnectionString(
  databaseUrl: string,
  databaseName: string,
): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * Creates a disposable Postgres database, applies the full migration stack, and
 * returns a dedicated Prisma client. Drop the database via `dispose()` when done.
 */
export async function createIsolatedIntegrationDatabase(
  label = "contract",
): Promise<IsolatedIntegrationDatabase> {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("DATABASE_URL is required for isolated integration databases");
  }

  const databaseName = `acc_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const connectionString = isolatedConnectionString(sourceUrl, databaseName);
  const adminUrl = adminConnectionString(sourceUrl);

  const createPool = new Pool({ connectionString: adminUrl });
  try {
    await createPool.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await createPool.end();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  async function dispose(): Promise<void> {
    await prisma.$disconnect();

    const dropPool = new Pool({ connectionString: adminUrl });
    try {
      await dropPool.query(
        `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
        `,
        [databaseName],
      );
      await dropPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await dropPool.end();
    }
  }

  return { prisma, databaseName, connectionString, dispose };
}
