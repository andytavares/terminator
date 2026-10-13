import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 6007

// Screenshots of every built story, dark and light, at the app's default window size (ADR 098).
// Fonts are bundled, but the browser build and OS still change pixels, so each platform keeps its
// own baselines (https://playwright.dev/docs/test-snapshots); CI compares on Linux only.
export default defineConfig({
  testDir: 'visual',
  testMatch: '**/*.visual.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? 'dot' : 'list',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // --host: on a runner where localhost resolves to ::1 the server would not
    // answer on 127.0.0.1, the address Playwright waits for.
    command: `npx vite preview --outDir storybook-static --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: dirname,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !process.env.CI,
  },
})
