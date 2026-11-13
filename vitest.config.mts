import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      src: resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./test/setup-env.ts'],
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
