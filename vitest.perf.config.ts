import { defineConfig } from 'vitest/config'

// The wall-clock budgets (`*.perf.spec.ts`), which the default run excludes.
//
// A budget like "p95 ≤ 16 ms" measures the machine as much as the code. In the
// default run it shares the CPU with every other spec file in parallel, so it
// failed whenever the machine was busy and said nothing about the code. Here
// the files run one at a time, in a job of their own.
//
//   npm run test:perf
export default defineConfig({
  test: {
    name: 'perf',
    environment: 'node',
    include: ['extensions/*/tests/**/*.perf.spec.ts', 'tests/**/*.perf.spec.ts'],
    fileParallelism: false,
  },
})
