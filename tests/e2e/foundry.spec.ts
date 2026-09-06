import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'

// Foundry, driven through the running application.
//
// Two claims, and neither is provable below this level. First: all four
// surfaces render and are reachable by their accessible names — the extension's
// UI is an overlaid WebContentsView, so Playwright's page cannot see it and a
// jsdom render of the same components proves the components, not the app.
// Second: the seams hold end to end — an idea becomes an order, the order
// compiles, and the order the Line reads is the one the Forge agreed.
//
// This replaces the SpecKit supervised-run spec, which drove `speckit:*`
// channels that no longer exist.

let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  const env = { ...process.env }
  // Deleted rather than blanked: inherited from an outer git inside a hook they
  // point every command at the wrong repository, and an empty GIT_DIR is not
  // "unset", it is an invalid path.
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

test.beforeAll(async () => {
  // Loading every bundled extension takes longer than the default hook budget.
  test.setTimeout(180_000)
  repo = mkdtempSync(join(tmpdir(), 'foundry-repo-'))
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  // A real manifest, so the toolchain probe has something to find and the
  // "not measured" path is not the only one exercised.
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok', lint: 'echo ok' } }, null, 2)
  )
  git('add', '.')
  git('commit', '-m', 'initial')

  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry', repo)
  await handle.page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

/** Calls one of the extension's own IPC channels, exactly as its UI does. */
async function foundry(channel: string, payload: unknown = {}): Promise<unknown> {
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

/** Runs a script inside Foundry's own view, which the page cannot reach. */
function inFoundry<T>(script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

/**
 * Click a control inside the view by its accessible name.
 *
 * By role and name rather than by class, because a class is an implementation
 * detail: a refactor that changes nothing a user sees should not break this,
 * and one that renames a button should.
 */
function clickByName(role: string, name: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var selector = ${JSON.stringify(role === 'button' ? 'button' : `[role="${role}"]`)}
    var all = document.querySelectorAll(selector)
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label === ${JSON.stringify(name)}) { all[i].click(); return true }
    }
    return false
  })()`)
}

function bodyText(): Promise<string> {
  return inFoundry<string>('document.body.innerText')
}

async function openFoundry(): Promise<void> {
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  if ((await panel.count()) === 0) {
    await handle.page.locator('button[aria-label="Foundry"]').click()
  }
  await expect(panel).toHaveCount(1, { timeout: 20000 })
  await handle.page.waitForTimeout(2500)
}

test('the extension is loaded and answering', async () => {
  // If this rejects, the extension did not activate and every assertion below
  // would fail for a reason that has nothing to do with what it is testing.
  const orders = (await foundry('foundry:order.list')) as { orders?: unknown[] }
  expect(Array.isArray(orders.orders)).toBe(true)
})

test('every surface is reachable by its accessible name and renders', async () => {
  await openFoundry()

  // The inbox is home: it is what is on screen before anything is clicked.
  expect(await bodyText()).toContain('Nothing needs you')
  expect(
    await inFoundry<string | null>(
      `(document.querySelector('button[aria-pressed="true"]') || {}).textContent || null`
    )
  ).toBe('Inbox')

  // Identified by something the surface always shows, not by its empty state:
  // these tests share one app, so by the time this runs the Forge has orders
  // and the Ledger has entries.
  for (const [tab, expected] of [
    ['Forge', 'New order'],
    ['Ledger', 'What do I keep rejecting?'],
    ['Inbox', 'Nothing needs you'],
  ] as const) {
    expect(await clickByName('button', tab), `no control named "${tab}"`).toBe(true)
    await handle.page.waitForTimeout(600)
    const text = await bodyText()
    expect(text, `"${tab}" did not render`).toContain(expected)
  }

  // The fourth surface is behind the settings control, which is addressed by
  // its label because it draws only an icon.
  expect(await clickByName('button', 'Settings')).toBe(true)
  await handle.page.waitForTimeout(600)
  // Not the heading: `innerText` reflects `text-transform`, so "Model" comes
  // back uppercased and an exact match would be asserting the stylesheet.
  expect(await bodyText()).toContain('Use my Claude Code default')

  expect(await clickByName('button', 'Back')).toBe(true)
  await handle.page.waitForTimeout(400)
})

test('nothing on any surface threw while rendering', async () => {
  await openFoundry()
  const thrown = await inFoundry<string[]>('window.__thrown || []')
  expect(thrown).toEqual([])
})

test('an idea becomes an order the Forge can show', async () => {
  const created = (await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'rows are clipped at the right edge of src/terminal/row.ts' },
    repoPaths: [repo],
  })) as { order?: { id: string; status: string }; error?: string }

  expect(created.error).toBeUndefined()
  expect(created.order?.status).toBe('draft')

  const listed = (await foundry('foundry:order.list')) as { orders: { id: string }[] }
  expect(listed.orders.map((o) => o.id)).toContain(created.order?.id)
})

test('the repository is read before the operator is asked anything', async () => {
  const created = (await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'the lint command is wrong' },
    repoPaths: [repo],
  })) as { order: { context: { toolchain: Record<string, unknown> } }; unavailableChecks: string[] }

  // The fixture declares `test` and `lint`, so those are probed and the rest
  // are honestly reported as unmeasurable here.
  expect(created.order.context.toolchain.test).toMatchObject({ source: 'package.json' })
  expect(created.unavailableChecks).toContain('coverage')
})

test('an incomplete order is refused, and says what is missing', async () => {
  const created = (await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'something vague' },
    repoPaths: [repo],
  })) as { order: { id: string } }

  const compiled = (await foundry('foundry:order.compile', {
    id: created.order.id,
    commit: true,
  })) as { order: { status: string }; compile: { ok: boolean; failures: { check: string }[] } }

  expect(compiled.compile.ok).toBe(false)
  expect(compiled.order.status).toBe('draft')
  expect(compiled.compile.failures.length).toBeGreaterThan(0)
})

test('a run cannot be started from an order nobody agreed', async () => {
  const created = (await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'start me without agreeing' },
    repoPaths: [repo],
  })) as { order: { id: string } }

  const started = (await foundry('foundry:run.start', { id: created.order.id })) as {
    error?: string
  }
  expect(started.error).toBeDefined()
})

test('the ledger records what happened, attributably', async () => {
  const record = (await foundry('foundry:ledger.query', {})) as {
    entries: { actor: string; action: string; reason: string }[]
    actions: string[]
  }
  expect(record.actions).toContain('order.seeded')
  for (const entry of record.entries) {
    expect(entry.actor, 'an unattributed entry is not a record of a decision').not.toBe('')
    expect(entry.action).not.toBe('')
  }
})

test('the curator proposes nothing from a record with no repetition in it', async () => {
  const proposals = (await foundry('foundry:rules.propose', {})) as { proposals: unknown[] }
  expect(proposals.proposals).toEqual([])
})

test('Foundry changes nothing in the repository it works on', async () => {
  // The claim the whole portability story rests on, checked against a real
  // repository after real orders have been created in it.
  //
  // The one thing it may leave is its own records directory, and only when the
  // default location is in use — which is exactly what ADR-042 says the
  // default costs, and what the setting avoids. Everything else is a failure:
  // no modified file, no deleted file, no new file of any other kind, and
  // above all no `.gitignore` entry, because editing that would be changing a
  // file no order asked to change.
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()
  const left = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => line !== '?? .foundry/')

  expect(left, `Foundry left files behind:\n${status}`).toEqual([])

  const ignore = execFileSync('git', ['ls-files', '.gitignore'], { cwd: repo }).toString()
  expect(ignore.trim(), 'Foundry created a .gitignore').toBe('')
})

test('every registered channel answers rather than rejecting', async () => {
  // A channel registered and unreachable is dead wiring; a channel that
  // rejects on its own name is worse, because a surface calling it fails at
  // the moment the operator presses the button.
  const channels = [
    'foundry:order.list',
    'foundry:inbox.list',
    'foundry:ledger.query',
    'foundry:permissions-list',
    'foundry:models-list',
    'foundry:supervision-snapshot',
    'foundry:stalls-list',
  ]
  for (const channel of channels) {
    await expect(foundry(channel, {}), `${channel} rejected`).resolves.toBeTruthy()
  }
})
