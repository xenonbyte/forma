import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/puppeteer-parser.ts"],
  format: ["cjs", "esm"],
  splitting: false,
  sourcemap: true,
  treeshake: false,
  cjsInterop: true,
  external: ["puppeteer"],
  dts: {
    compilerOptions: {
      skipLibCheck: true,
    },
  },
});
