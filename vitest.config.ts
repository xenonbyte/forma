import { defineConfig } from "vitest/config";

const workspaceAliases = {
  "@xenonbyte/forma-agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-server": new URL("./packages/server/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-web": new URL("./packages/web/src/App.tsx", import.meta.url).pathname
};

export default defineConfig({
  resolve: {
    alias: workspaceAliases
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "packages/web/src/**/*.test.ts", "packages/web/src/**/*.test.tsx"],
    passWithNoTests: true
  }
});
