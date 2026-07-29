import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // Real-Postgres integration suites share one database; running files in
    // parallel causes Serializable transaction conflicts (#174 PR 3).
    fileParallelism: process.env.INTEGRATION_DB === "true" ? false : undefined,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "next/server": path.resolve(__dirname, "node_modules/next/server.js"),
      "server-only": path.resolve(__dirname, "app/src/lib/testing/serverOnlyMock.ts"),
    },
  },
});
