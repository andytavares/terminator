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
    // A story is a test only when its play function asserts something: Storybook tags it play-fn.
    // A story that only renders is documentation, and story-screenshots pictures it (T-CAN-FAIL).
    storybookTest({
      configDir: path.join(dirname, '.storybook'),
      storybookScript: 'npm run storybook',
      tags: { include: ['play-fn'] },
    }),
  ],
  test: {
    name: 'stories',
    // Every run shuffles, as the repository's own suite does (T-ALONE).
    sequence: { shuffle: { files: true, tests: true } },
    restoreMocks: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
