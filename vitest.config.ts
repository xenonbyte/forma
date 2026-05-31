import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

const workspaceAliases = {
  "@xenonbyte/forma-agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-server": new URL("./packages/server/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-web": new URL("./packages/web/src/App.tsx", import.meta.url).pathname,
  "@xenonbyte/forma-viewer": new URL("./packages/viewer/src/index.ts", import.meta.url).pathname
};

export default defineConfig({
  resolve: {
    alias: workspaceAliases
  },
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        // 既有 node 单元/组件测试(含 viewer 纯逻辑 tests/),环境 node。
        resolve: { alias: workspaceAliases },
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: [
            "packages/*/tests/**/*.test.ts",
            "packages/web/src/**/*.test.ts",
            "packages/web/src/**/*.test.tsx"
          ],
          // 浏览器组件测试由下面的 viewer 项目跑;保留 vitest 默认排除(node_modules/dist/…)。
          exclude: [...configDefaults.exclude, "**/*.browser.test.tsx"]
        }
      },
      {
        // viewer 组件测试,真实浏览器(playwright/chromium)。
        resolve: { alias: workspaceAliases },
        // 预打包 React JSX runtime:否则 Vite 会在跑测试途中才发现 react/jsx-dev-runtime
        // 并 reload,触发 "Vite unexpectedly reloaded a test" flaky 警告。
        // include 在工作区根解析,故 root devDeps 需含 react/react-dom(见 root package.json)。
        optimizeDeps: {
          include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]
        },
        test: {
          name: "viewer",
          globals: true,
          include: ["packages/viewer/src/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }]
          }
        }
      }
    ]
  }
});
