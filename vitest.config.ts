import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

export const workspaceAliases: Record<string, string> = {
  "@vzi-core/types": new URL("./packages/vzi-types/src/index.ts", import.meta.url).pathname,
  "@vzi-core/format": new URL("./packages/vzi-format/src/index.ts", import.meta.url).pathname,
  "@vzi-core/parser": new URL("./packages/vzi-parser/src/index.ts", import.meta.url).pathname,
  "@vzi-core/transformer": new URL("./packages/vzi-transformer/src/index.ts", import.meta.url).pathname,
  "@vzi-core/renderer": new URL("./packages/vzi-renderer/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
  "@xenonbyte/forma-cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
  // Browser-safe quality subpath. MUST precede the "@xenonbyte/forma-core" root
  // alias: Vite/rollup object-alias matches in insertion order with the first hit
  // winning, and the bare "@xenonbyte/forma-core" find prefix-matches
  // "@xenonbyte/forma-core/quality". Listing it first keeps the /quality import on
  // src/quality/index.ts (no fs/path/node imports), not the Node-only root index.
  "@xenonbyte/forma-core/quality": new URL("./packages/core/src/quality/index.ts", import.meta.url).pathname,
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
          include: [
            "react",
            "react-dom",
            "react-dom/client",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "@xyflow/react"
          ]
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
      },
      {
        // P9.6 dogfood: render the desktop shell screens in real chromium and
        // assert each passes the same lintCraft rules Forma applies to generated
        // artifacts. Mirrors the viewer project's playwright/chromium setup and
        // optimizeDeps (pre-bundle React JSX runtime + @xyflow/react) to avoid a
        // mid-run Vite reload. resolve.alias includes the browser-safe
        // @xenonbyte/forma-core/quality subpath (above the core root alias).
        resolve: { alias: workspaceAliases },
        optimizeDeps: {
          include: [
            "react",
            "react-dom",
            "react-dom/client",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "@xyflow/react"
          ]
        },
        test: {
          name: "desktop-shell",
          globals: true,
          include: ["packages/desktop/src/renderer/**/*.dogfood.browser.test.tsx"],
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
