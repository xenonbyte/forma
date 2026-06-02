import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  treeshake: false,
  cjsInterop: true,
  dtsConfig: {
    compilerOptions: {
      skipLibCheck: true,
    },
  },
});
