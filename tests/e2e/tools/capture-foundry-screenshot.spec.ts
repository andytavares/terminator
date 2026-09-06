import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync as write } from 'node:fs'
import { launchApp, closeApp, createWorkspace, type AppHandle } from '../helpers'

// Retakes the user-guide screenshot of the Foundry tab.
//
// Not part of the suite — `playwright.config.ts` excludes `tools/` — because it
// writes into `docs/`, and a test that rewrites a committed file on every CI
// run is a test that produces a dirty tree. Run it deliberately when the
// surface changes:
//
//   E2E_TOOLS=1 npx playwright test tests/e2e/tools/capture-foundry-screenshot.spec.ts

let handle: AppHandle
let repo: string

test('capture the Foundry surfaces', async () => {
  test.setTimeout(180_000)
  repo = mkdtempSync(join(tmpdir(), 'foundry-shot-'))
  const git = (...args: string[]): void => {
    const env = { ...process.env }
    delete env.GIT_DIR
    delete env.GIT_INDEX_FILE
    delete env.GIT_WORK_TREE
    execFileSync('git', args, { cwd: repo, env })
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'shot@example.com')
  git('config', 'user.name', 'Shot')
  writeFileSync(join(repo, 'README.md'), '# terminator\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify(
      { name: 'terminator', scripts: { test: 'vitest run', lint: 'eslint .' } },
      null,
      2
    )
  )
  git('add', '.')
  git('commit', '-m', 'initial')

  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', repo)
  await handle.page.waitForTimeout(2500)

  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3500)

  const dir = join(process.cwd(), 'docs', 'user-guide', 'screenshots')
  mkdirSync(dir, { recursive: true })

  // The image comes back as base64 rather than being written inside the main
  // process: `evaluate` runs there, but only serialisable values cross back.
  const png = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })
  write(join(dir, '08-foundry-tab.png'), Buffer.from(png, 'base64'))

  await closeApp(handle)
})
