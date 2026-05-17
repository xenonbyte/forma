import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "packages/web/src/**/*.test.tsx"],
    passWithNoTests: true
  }
});
