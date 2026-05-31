import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/__mocks__/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/*.browser.test.tsx'],
  },
});
