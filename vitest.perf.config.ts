import { defineConfig } from 'vitest/config'

// The wall-clock budgets (`*.perf.spec.ts`), one file at a time: beside other
// specs in parallel a budget measures the machine's load, not the code.
// npm run test:perf
export default defineConfig({
  test: {
    name: 'perf',
    environment: 'node',
    include: ['extensions/*/tests/**/*.perf.spec.ts', 'tests/**/*.perf.spec.ts'],
    fileParallelism: false,
  },
})
