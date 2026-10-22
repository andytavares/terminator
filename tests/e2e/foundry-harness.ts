import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, workspaceRow, e2eTempDir, inExtensionView } from './helpers'
import { extensionPage } from './extension-page'
import type { AppHandle } from './helpers'

// Shared helpers for every `tests/e2e/foundry-*.spec.ts` file. Each spec keeps
// its own `handle`/`repo` — a fresh app and a fresh fixture repository, in its
// own `beforeAll` — so tests in one file never depend on what another file (or
// an earlier test in the same file) left behind. These functions take the
// handle explicitly rather than closing over module state, so nothing here can
// grow shared state of its own by accident.

/** Runs `git` against the fixture repo, with any inherited GIT_* stripped so a
 *  git hook running this suite does not point every command at itself, and
 *  returns its trimmed output. */
export function git(repo: string, ...args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim()
}

/** A minimal git repository with a real toolchain, exactly what every foundry
 *  spec seeds before launching the app. */
export function makeFixtureRepo(prefix: string): string {
  const repo = e2eTempDir(prefix)
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
    ([ch, body]) => window.electronAPI.extensionBridge.invoke(ch as string, body),
    [channel, payload] as [string, unknown]
  )
}

/** Runs a script inside Foundry's frame in the main window. */
export function inFoundry<T>(handle: AppHandle, script: string): Promise<T> {
  return inExtensionView<T>(handle, 'foundry', script)
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

/** Closes the app and opens it again on the same profile, with Foundry showing. Foundry
 * reads its records from disk once, so a spec that writes them by hand restarts after,
 * as an operator who edited them would. */
export async function restartFoundry(handle: AppHandle, workspaceName: string): Promise<AppHandle> {
  const userDataDir = handle.userDataDir
  await closeApp(handle)
  const next = await launchApp(userDataDir)
  await expect(workspaceRow(next.page, workspaceName)).toBeVisible()
  await openFoundry(next)
  return next
}

/** Opens the Foundry panel and waits until its view has actually rendered
 *  something — polled rather than slept, so this never races the extension's
 *  lazy activation. */
export async function openFoundry(handle: AppHandle): Promise<void> {
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  if ((await panel.count()) === 0) {
    const button = handle.page.locator('button[aria-label="Foundry"]')
    await expect(button).toBeVisible()
    await button.click()
  }
  await expect(panel).toHaveCount(1)
  // The channel answers through the main window's own bridge, which needs
  // nothing from the extension's frame — so it is checked first, exactly as
  // every foundry spec's own `beforeAll` used to. Only once the extension has
  // activated is the frame `inFoundry` reaches worth polling for.
  await expect
    .poll(
      async () => (await foundryChannel(handle, 'foundry:order.list').catch(() => null)) !== null
    )
    .toBe(true)
  // The channel answers as soon as the extension host has activated, but the
  // frame `inFoundry` reaches attaches a little later — polled with its
  // rejection caught, since `expect.poll` does not retry a callback that
  // throws, only one whose returned value mismatches.
  await expect
    .poll(async () => {
      try {
        return await inFoundry<number>(handle, `document.querySelectorAll('button').length`)
      } catch {
        return 0
      }
    })
    .toBeGreaterThan(0)
}

/** Opens the Forge tab and waits for its own content to have rendered. */
export async function openForge(handle: AppHandle): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'Forge')).toBe(true)
  await expect.poll(() => bodyText(handle)).toMatch(/New order|Steps|All orders|STATUS WALL/)
}

/** Run in Foundry's view: whether some button's text contains `id`. */
function orderRowListed(id: string): string {
  return `(function () {
        var all = document.querySelectorAll('button')
        for (var i = 0; i < all.length; i++) {
          if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) return true
        }
        return false
      })()`
}

/** Run in Foundry's view: clicks the first button whose text contains `id`, and says whether one did. */
function clickOrderRow(id: string): string {
  return `(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) {
        all[i].click()
        return true
      }
    }
    return false
  })()`
}

/** Shows every order in the Forge, and waits until the row for `id` is among them. */
export async function listOrdersInForge(handle: AppHandle, id: string): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'Forge')).toBe(true)
  await expect.poll(() => bodyText(handle)).toMatch(/New order|Steps|All orders/)
  // An earlier order may already be open; get back to the list first.
  await clickByName(handle, 'button', 'All orders')
  await expect.poll(() => inFoundry<boolean>(handle, orderRowListed(id))).toBe(true)
}

/** Clicks the listed Forge row whose visible text contains `id`, opening it. */
export async function openListedOrder(handle: AppHandle, id: string): Promise<void> {
  const opened = await inFoundry<boolean>(handle, clickOrderRow(id))
  expect(opened, `no row for ${id} in the Forge`).toBe(true)
}

/**
 * The launch script the terminal was told to run, and what is in it.
 *
 * The launch is a file rather than a typed line — a terminal in canonical
 * mode mangles anything past 1024 bytes, and a brief is always longer. So
 * "what is this agent running" is answered by reading that file, not by
 * scraping a screen an agent's own output may since have scrolled past.
 */
/** The newest launch script that starts an agent. Order creation also launches the environment
 *  baseline (build, test) through the same folder, so the newest script is not always the agent's. */
export function agentLaunchScript(handle: AppHandle): string {
  // Foundry's own folder (ADR 103): <userData>/extensions/<id>/runtime.
  const dir = join(handle.userDataDir, 'extensions', 'terminator.foundry', 'runtime', 'launch')
  const agentScripts = readdirSync(dir)
    .filter((name) => name.endsWith('.sh'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .map((path) => readFileSync(path, 'utf8'))
    .filter(launchesAgent)
  if (agentScripts.length === 0) throw new Error(`no agent launch script was written in ${dir}`)
  return agentScripts[agentScripts.length - 1]
}

/** True when the script's command line starts claude, not a baseline step such as `npm run test`. */
function launchesAgent(script: string): boolean {
  return /(^|[\s(;])claude\s/m.test(script)
}

/** Whether an agent launch script has been written yet — the poll condition to wait
 *  on instead of reading terminal scrollback, which a talkative agent scrolls
 *  out of view. */
export function hasAgentLaunchScript(handle: AppHandle): boolean {
  try {
    agentLaunchScript(handle)
    return true
  } catch {
    return false
  }
}

export async function captureFoundry(handle: AppHandle, name: string): Promise<void> {
  const outDir = join(process.cwd(), 'test-results')
  mkdirSync(outDir, { recursive: true })
  const view = await extensionPage(handle, 'foundry')
  writeFileSync(join(outDir, name), await view.screenshot())
}

/** Creates a typed order on `repo` and returns its id; `missing` is the failure's message. */
export async function createTypedOrder(
  handle: AppHandle,
  order: { repo: string; text: string; missing: string }
): Promise<string> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: order.text },
    repoPaths: [order.repo],
  })) as { order?: { id: string } }
  const id = created.order?.id as string
  expect(id, order.missing).toBeTruthy()
  return id
}
