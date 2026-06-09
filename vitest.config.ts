import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'workers/**/*.test.ts'],
    environment: 'node',
  },
});
