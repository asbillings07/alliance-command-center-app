import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // Integration tests share one Postgres database; serialize files to avoid races.
    ...(process.env.INTEGRATION_DB === "true" ? { fileParallelism: false } : {}),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "next/server": path.resolve(__dirname, "node_modules/next/server.js"),
      "server-only": path.resolve(__dirname, "app/src/lib/testing/serverOnlyMock.ts"),
    },
  },
});
