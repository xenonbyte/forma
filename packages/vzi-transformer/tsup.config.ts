import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  splitting: false,
  sourcemap: true,
  treeshake: false,
  cjsInterop: true,
  dts: {
    compilerOptions: {
      skipLibCheck: true,
    },
  },
});
