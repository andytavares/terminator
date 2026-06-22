import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  // CI runners are resource-constrained and each test launches a full Electron
  // app, so cap parallelism and allow one retry to absorb rare launch flakes.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
})
