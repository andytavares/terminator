import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppHandle } from './helpers'

// Shared helpers for every `tests/e2e/foundry-*.spec.ts` file. Each spec keeps
// its own `handle`/`repo` — a fresh app and a fresh fixture repository, in its
// own `beforeAll` — so tests in one file never depend on what another file (or
// an earlier test in the same file) left behind. These functions take the
// handle explicitly rather than closing over module state, so nothing here can
// grow shared state of its own by accident.

/** Runs `git` against the fixture repo, with any inherited GIT_* stripped so a
 *  git hook running this suite does not point every command at itself. */
export function git(repo: string, ...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

/** A minimal git repository with a real toolchain, exactly what every foundry
 *  spec seeds before launching the app. */
export function makeFixtureRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix))
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  git(repo, 'config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok', lint: 'echo ok' } }, null, 2)
  )
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  return repo
}

/** Calls one of the extension's own IPC channels, exactly as its UI does. */
export function foundryChannel(
  handle: AppHandle,
  channel: string,
  payload: unknown = {}
): Promise<unknown> {
  return handle.page.evaluate(
    ([ch, body]) =>
      (
        window as unknown as {
          electronAPI: { extensionBridge: { invoke(c: string, p: unknown): Promise<unknown> } }
        }
      ).electronAPI.extensionBridge.invoke(ch as string, body),
    [channel, payload] as [string, unknown]
  )
}

/** Runs a script inside Foundry's own view, which the page cannot reach —
 *  it is an overlaid WebContentsView. */
export function inFoundry<T>(handle: AppHandle, script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

/**
 * Click a control inside the view by its accessible name, by role and name
 * rather than by class: a class is an implementation detail, a refactor that
 * renames a button should break this and one that changes nothing a user
 * sees should not.
 */
export function clickByName(handle: AppHandle, role: string, name: string): Promise<boolean> {
  return inFoundry<boolean>(
    handle,
    `(function () {
    var selector = ${JSON.stringify(role === 'button' ? 'button' : `[role="${role}"]`)}
    var want = ${JSON.stringify(name)}
    var all = document.querySelectorAll(selector)
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label === want || label.indexOf(want + ', ') === 0) { all[i].click(); return true }
    }
    return false
  })()`
  )
}

/** Like `clickByName`, but by substring — a hall card's name is its title plus
 *  its standing label with no separator between them, so an exact match on
 *  the title alone never lands. */
export function clickContaining(
  handle: AppHandle,
  role: string,
  substring: string
): Promise<boolean> {
  return inFoundry<boolean>(
    handle,
    `(function () {
    var selector = ${JSON.stringify(role === 'button' ? 'button' : `[role="${role}"]`)}
    var want = ${JSON.stringify(substring)}
    var all = document.querySelectorAll(selector)
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label.indexOf(want) !== -1) { all[i].click(); return true }
    }
    return false
  })()`
  )
}

export function pressedByLabel(handle: AppHandle, label: string): Promise<string | null> {
  return inFoundry<string | null>(
    handle,
    `(function () {
    var el = document.querySelector('button[aria-label=${JSON.stringify(label)}]')
    return el ? el.getAttribute('aria-pressed') : null
  })()`
  )
}

/** Types into a React-controlled input inside the view, found by its accessible name. */
export function fillByName(handle: AppHandle, name: string, value: string): Promise<boolean> {
  return inFoundry<boolean>(
    handle,
    `(function () {
    var input = document.querySelector(${JSON.stringify(`input[aria-label="${name}"]`)})
    if (!input) return false
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`
  )
}

export function bodyText(handle: AppHandle): Promise<string> {
  return inFoundry<string>(handle, 'document.body.innerText')
}

/** How many run-graph station buttons the hall overlay has drawn. */
export function stationCount(handle: AppHandle): Promise<number> {
  return inFoundry<number>(
    handle,
    `document.querySelectorAll('button[aria-label*=", attempt "]').length`
  )
}

/** Whether a station button exists whose accessible name starts with `prefix`. */
export function hasStation(handle: AppHandle, prefix: string): Promise<boolean> {
  return inFoundry<boolean>(
    handle,
    `(function () {
    var want = ${JSON.stringify(prefix)}
    var all = document.querySelectorAll('button[aria-label]')
    for (var i = 0; i < all.length; i++) {
      var label = all[i].getAttribute('aria-label') || ''
      if (label.indexOf(want) === 0) return true
    }
    return false
  })()`
  )
}

/** Opens the Foundry panel and waits until its view has actually rendered
 *  something — polled rather than slept, so this never races the extension's
 *  lazy activation. */
export async function openFoundry(handle: AppHandle): Promise<void> {
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  if ((await panel.count()) === 0) {
    const button = handle.page.locator('button[aria-label="Foundry"]')
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
  }
  await expect(panel).toHaveCount(1, { timeout: 30_000 })
  // The channel answers through the main window's own bridge, which needs
  // nothing from the extension's own WebContentsView — so it is checked
  // first, exactly as every foundry spec's own `beforeAll` used to. Only once
  // the extension has activated is the view itself (which `inFoundry` reaches
  // via `getAllWebContents`) worth polling for.
  await expect
    .poll(
      async () => (await foundryChannel(handle, 'foundry:order.list').catch(() => null)) !== null,
      {
        timeout: 30_000,
      }
    )
    .toBe(true)
  // The channel answers as soon as the extension host has activated, but the
  // WebContentsView `inFoundry` reaches is attached separately and a little
  // later — polled with its rejection caught, since `expect.poll` does not
  // retry a callback that throws, only one whose returned value mismatches.
  await expect
    .poll(
      async () => {
        try {
          return await inFoundry<number>(handle, `document.querySelectorAll('button').length`)
        } catch {
          return 0
        }
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
}

/** Opens the Forge tab and waits for its own content to have rendered. */
export async function openForge(handle: AppHandle): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'Forge'), { timeout: 15_000 }).toBe(true)
  await expect
    .poll(() => bodyText(handle), { timeout: 15_000 })
    .toMatch(/New order|Steps|All orders|STATUS WALL/)
}

/**
 * The launch script the terminal was told to run, and what is in it.
 *
 * The launch is a file rather than a typed line — a terminal in canonical
 * mode mangles anything past 1024 bytes, and a brief is always longer. So
 * "what is this agent running" is answered by reading that file, not by
 * scraping a screen an agent's own output may since have scrolled past.
 */
export function launchScript(handle: AppHandle): string {
  const dir = join(handle.userDataDir, 'foundry-runtime', 'launch')
  const scripts = readdirSync(dir)
    .filter((name) => name.endsWith('.sh'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  if (scripts.length === 0) throw new Error(`no launch script was written in ${dir}`)
  return readFileSync(scripts[scripts.length - 1], 'utf8')
}

/** Whether a launch script has been written yet — the poll condition to wait
 *  on instead of reading terminal scrollback, which a talkative agent scrolls
 *  out of view. */
export function hasLaunchScript(handle: AppHandle): boolean {
  try {
    launchScript(handle)
    return true
  } catch {
    return false
  }
}

export async function captureFoundry(handle: AppHandle, name: string): Promise<void> {
  const outDir = join(process.cwd(), 'test-results')
  mkdirSync(outDir, { recursive: true })
  const pngBase64 = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(join(outDir, name), Buffer.from(pngBase64, 'base64'))
}
