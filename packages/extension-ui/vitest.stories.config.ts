import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Runs every story as a test in a real browser. Kept apart from the repository's
// own vitest.config.ts: it needs Playwright's chromium and a browser-mode project.
export default defineConfig({
  root: dirname,
  plugins: [
    storybookTest({
      configDir: path.join(dirname, '.storybook'),
      storybookScript: 'npm run storybook',
    }),
  ],
  test: {
    name: 'stories',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
