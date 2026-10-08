import { test, expect } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  bodyText,
  clickByName,
  foundryChannel,
  inFoundry,
  makeFixtureRepo,
  openFoundry,
} from './foundry-harness'

// Foundry, driven through the running application: the extension's own
// channels and chrome, and that every surface renders and reachable by its
// accessible name.
//
// Split out of what used to be `foundry.spec.ts` (see
// docs/research/e2e-deterministic-selective.md) — this file's own app and
// fixture repo, so every test here passes whether the suite runs it or `-g`
// picks it alone.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = makeFixtureRepo('foundry-channels-repo-')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Channels', repo)
  await openFoundry(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

test('the extension is loaded and answering', async () => {
  // If this rejects, the extension did not activate and every assertion below
  // would fail for a reason that has nothing to do with what it is testing.
  const orders = (await foundryChannel(handle, 'foundry:order.list')) as { orders?: unknown[] }
  expect(Array.isArray(orders.orders)).toBe(true)
})

test('the chrome says how much is waiting, from whichever surface you are on', async () => {
  // The channel behind the badge, answering in the running application. This
  // file's app has no orders in it yet, so the counts are asserted for shape
  // and self-consistency, not a specific number.
  const counts = (await foundryChannel(handle, 'foundry:attention')) as {
    inbox?: unknown
    forge?: unknown
    byOrder?: unknown
  }
  expect(typeof counts.inbox, JSON.stringify(counts)).toBe('number')
  expect(typeof counts.forge).toBe('number')
  expect(typeof counts.byOrder).toBe('object')

  const inbox = (await foundryChannel(handle, 'foundry:inbox.list')) as {
    gates: unknown[]
    waiting: unknown[]
  }
  expect(counts.inbox).toBe(inbox.gates.length + inbox.waiting.length)

  // And the badge is drawn from it, or not drawn when there is nothing to say.
  const badges = await inFoundry<number>(
    handle,
    `document.querySelectorAll('.fdry-tab-count').length`
  )
  expect(badges).toBe((counts.inbox === 0 ? 0 : 1) + ((counts.forge as number) === 0 ? 0 : 1))
})

test('every surface is reachable by its accessible name and renders', async () => {
  // The inbox is home: it is what is on screen before anything is clicked.
  await expect.poll(() => bodyText(handle), { timeout: 15_000 }).toContain('Nothing needs you')
  expect(
    await inFoundry<string | null>(
      handle,
      `(document.querySelector('button[aria-pressed="true"]') || {}).textContent || null`
    )
  ).toBe('Inbox')

  // Identified by something the surface always shows, not by its empty state.
  for (const [tab, expected] of [
    ['Forge', 'New order'],
    ['Ledger', 'What do I keep rejecting?'],
    ['Inbox', 'Nothing needs you'],
  ] as const) {
    expect(await clickByName(handle, 'button', tab), `no control named "${tab}"`).toBe(true)
    await expect.poll(() => bodyText(handle), { timeout: 15_000 }).toContain(expected)
  }

  // The fourth surface is behind the settings control, which is addressed by
  // its label because it draws only an icon.
  expect(await clickByName(handle, 'button', 'Settings')).toBe(true)
  // Not the heading: `innerText` reflects `text-transform`, so "Model" comes
  // back uppercased and an exact match would be asserting the stylesheet.
  await expect
    .poll(() => bodyText(handle), { timeout: 15_000 })
    .toContain('Use my Claude Code default')

  expect(await clickByName(handle, 'button', 'Back')).toBe(true)
})

test('nothing on any surface threw while rendering', async () => {
  await openFoundry(handle)
  const thrown = await inFoundry<string[]>(handle, 'window.__thrown || []')
  expect(thrown).toEqual([])
})

test('every registered channel answers rather than rejecting', async () => {
  // A channel registered and unreachable is dead wiring; a channel that
  // rejects on its own name is worse, because a surface calling it fails at
  // the moment the operator presses the button.
  //
  // Read from the source rather than listed here. The list was seven of
  // forty-three while the test's own name said "every", which is the shape of
  // a green nobody should have trusted.
  const source = readFileSync(
    join(process.cwd(), 'extensions', 'foundry', 'src', 'index.ts'),
    'utf8'
  )
  const channels = [...source.matchAll(/reg\(api,\s*'(foundry:[^']+)'/g)].map((m) => m[1])
  expect(channels.length).toBeGreaterThan(30)

  // Every one is called with an empty payload. A channel that needs arguments
  // answers `{ error: 'Malformed request.' }`, which is answering — the thing
  // being asserted is that none of them throws, and that none of them is
  // absent from the registry the host actually built.
  for (const channel of channels) {
    await expect(foundryChannel(handle, channel, {}), `${channel} rejected`).resolves.toBeDefined()
  }
})
