import { defineConfig } from 'vitest/config';

// Coverage is reported only. There is deliberately no threshold: a coverage
// tool that collected no data once failed a build where every test passed.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
