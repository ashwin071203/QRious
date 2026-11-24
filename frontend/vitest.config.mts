import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "src/server/test/server-only-stub.ts") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ["src/server/test/setup.ts"],
    globalSetup: ["src/server/test/global-setup.ts"],
  },
});
