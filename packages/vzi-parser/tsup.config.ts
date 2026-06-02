import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/puppeteer-parser.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  treeshake: false,
  cjsInterop: true,
  external: ['puppeteer'],
  dtsConfig: {
    compilerOptions: {
      skipLibCheck: true,
    },
  },
});
