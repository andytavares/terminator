import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync as write } from 'node:fs'
import { launchApp, closeApp, createWorkspace, type AppHandle } from '../helpers'

// Retakes the user-guide screenshots of the Foundry surfaces.
//
// One image per surface, because a structural assertion passes while the
// surface renders broken — an unstyled panel, a control off the edge, a table
// that overflows. Looking at the picture is the only check for that.
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

  // The Ledger's accepted-checks panel only appears when there is something in
  // it, and the records location defaults to `<workdir>/.foundry/`. Seeded
  // here so the screenshot shows the panel rather than its absence.
  mkdirSync(join(repo, '.foundry', 'rules'), { recursive: true })
  writeFileSync(
    join(repo, '.foundry', 'rules', 'curator-hardcodes-the-timeout.yaml'),
    [
      'schemaVersion: 1',
      'id: curator-hardcodes-the-timeout',
      'scope: universal',
      'rung: L3',
      'asserts: >',
      '  No unit hardcodes a timeout; it is read from configuration.',
      'appliesWhen: always',
      'origin: curator:2026-09-01T10:00:00.000Z/U-1',
      '',
    ].join('\n')
  )

  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', repo)
  await handle.page.waitForTimeout(2500)

  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3500)

  const dir = join(process.cwd(), 'docs', 'user-guide', 'screenshots')
  mkdirSync(dir, { recursive: true })

  // The image comes back as base64 rather than being written inside the main
  // process: `evaluate` runs there, but only serialisable values cross back.
  const capture = async (): Promise<Buffer> => {
    const png = await handle.app.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
      if (!view) throw new Error('the Foundry view is not loaded')
      const image = await view.capturePage()
      return image.toPNG().toString('base64')
    })
    return Buffer.from(png, 'base64')
  }

  // Clicks land inside the extension's own WebContentsView, which Playwright's
  // `page` cannot see. Sent through the view's input queue instead, by the
  // accessible name the tab renders.
  const openSurface = async (label: string): Promise<void> => {
    await handle.app.evaluate(async ({ webContents }, name: string) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
      if (!view) throw new Error('the Foundry view is not loaded')
      await view.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === ${JSON.stringify(
          name
        )})?.click()`
      )
    }, label)
    await handle.page.waitForTimeout(1200)
  }

  write(join(dir, '08-foundry-tab.png'), await capture())

  // An empty Forge shows a text box and nothing else. Seeded with a real idea
  // so the picture shows what the surface is actually for: the criteria, the
  // assumptions and the shape of work with the reason it was proposed.
  await openSurface('Forge')
  await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    await view.executeJavaScript(`
      (() => {
        const box = document.querySelector(
          'input[aria-label="Describe what you want built or fixed"]'
        )
        if (!box) throw new Error('the idea box is not on the Forge')
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set
        setter?.call(box, 'Session tokens are never refreshed, so long-lived tabs sign out')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        const create = Array.from(document.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('New order')
        )
        if (!create) throw new Error('the New order button is not on the Forge')
        create.click()
      })()
    `)
  })
  await handle.page.waitForTimeout(4000)
  write(join(dir, '08b-foundry-forge.png'), await capture())

  await openSurface('Ledger')
  write(join(dir, '08c-foundry-ledger.png'), await capture())

  // Settings is behind the gear rather than a named tab, so it is reached by
  // its accessible name. Worth a picture of its own: every control here is one
  // the extension actually reads, and the panel is where that shows.
  await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    await view.executeJavaScript(`document.querySelector('button[aria-label="Settings"]')?.click()`)
  })
  await handle.page.waitForTimeout(1500)
  write(join(dir, '08d-foundry-settings.png'), await capture())

  await closeApp(handle)
})
