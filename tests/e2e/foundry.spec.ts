import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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

/**
 * The launch script the terminal was told to run, and what is in it.
 *
 * The launch is a file rather than a typed line — a terminal in canonical mode
 * mangles anything past 1024 bytes, and a brief is always longer. So "what is
 * this agent running" is answered by reading that file, not by scraping a
 * screen the agent has since scrolled past.
 */
function launchScriptFor(terminalText: string): string {
  // xterm hard-wraps, so the path arrives with newlines through the middle of
  // it. Whitespace comes out before matching; the quotes are what delimit it.
  const unwrapped = terminalText.replace(/\s+/g, '')
  const match = /'([^']*\/launch\/[\w-]+\.sh)'/.exec(unwrapped)
  if (match === null) {
    throw new Error(`no launch script in the terminal: ${unwrapped.slice(0, 300)}`)
  }
  return readFileSync(match[1], 'utf8')
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

  // Extensions activate lazily, so a channel called before the host has loaded
  // this one is refused with "no handler registered". Opening the panel and
  // then waiting for a channel to answer is what makes every test below
  // independent of which ones ran first — and `-g` runs honest.
  await openFoundry()
  await expect
    .poll(async () => (await foundry('foundry:order.list').catch(() => null)) !== null, {
      timeout: 30_000,
    })
    .toBe(true)
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
    // The sidebar button appears once the host has enumerated extensions, so
    // it is waited for rather than clicked at whatever moment this runs.
    const button = handle.page.locator('button[aria-label="Foundry"]')
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
  }
  await expect(panel).toHaveCount(1, { timeout: 30_000 })
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
  // Seeds its own order rather than relying on an earlier test's, so running
  // this one alone asserts the same thing as running it in the suite.
  await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'something to record' },
    repoPaths: [repo],
  })

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
  await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'nothing repeated here' },
    repoPaths: [repo],
  })
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
    await expect(foundry(channel, {}), `${channel} rejected`).resolves.toBeDefined()
  }
})

/**
 * The claim the whole Line rests on: a unit runs as a real agent, in a real
 * terminal, in its own worktree, and you can see it.
 *
 * Every unit below this passes in isolation and so did every one of the worst
 * bugs on this line of work — no terminal, the wrong workspace, a relative
 * settings path that killed the run while the graph still said "running".
 * They only appear when the application runs.
 */
/**
 * The half without which nothing else can happen.
 *
 * A seeded draft has a problem statement and no criteria and no plan, so the
 * compile gate refuses it for ever. Something has to turn that into a plan,
 * and that something is an agent. Until this ran, nothing did — and the only
 * route to a runnable order was hand-writing its JSON.
 */
test('intake launches the architect against the draft, read-only, in the repository', async () => {
  test.setTimeout(180_000)
  const { page } = handle

  const created = (await foundry('foundry:order.create', {
    source: { kind: 'typed', text: 'greet should take a name, in README.md' },
    repoPaths: [repo],
  })) as { order: { id: string; acceptance: unknown[] } }

  // A seeded draft has nothing to hand off. That is the state intake exists
  // to move, and asserting it here is what makes the next assertion mean
  // something.
  expect(created.order.acceptance).toEqual([])

  const converged = (await foundry('foundry:order.converge', { id: created.order.id })) as {
    error?: string
  }
  // It either ran or said why. Silence would be the bug.
  expect(converged).not.toBeNull()

  const project = page.locator('.branch-row__name').filter({ hasText: 'intake' })
  await expect(project.first()).toBeVisible({ timeout: 60_000 })
  await project.first().click()

  const screen = page.locator('.xterm-screen')
  // The script's own path is what is typed, and it is short enough to survive.
  await expect(screen).toContainText('/launch/', { timeout: 60_000 })
  const launched = launchScriptFor((await screen.first().innerText()) ?? '')
  expect(launched).toContain('claude --session-id')
  // Never the thing this replaced: an invisible agent approving its own calls.
  expect(launched).not.toContain('bypassPermissions')
  // A relative settings path resolves against the worktree, where it does not
  // exist, and the run dies on "Settings file not found".
  expect(launched).toMatch(/--settings '\//)
  // And it does not carry the parent Claude Code session in with it.
  expect(launched).toMatch(/^unset .*CLAUDE_CODE_BRIDGE_SESSION_ID/m)

  // Intake runs in the repository itself — no worktree is cut for a plan that
  // may never be agreed.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).not.toContain('intake')
})

test('a run cuts a worktree and launches a supervised agent in a visible terminal', async () => {
  test.setTimeout(180_000)
  const { page } = handle

  // A complete order, written where the extension keeps its records. The Forge
  // is what fills one in normally and has its own cover; what is under test
  // here is everything after it.
  const id = 'WO-E2E-1'
  const dir = join(repo, '.foundry', 'orders', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'order.json'),
    JSON.stringify({
      schemaVersion: 1,
      id,
      title: 'Greet by name',
      status: 'agreed',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      writeBack: [],
      stateMapping: { started: null, in_review: null, done: null },
      recipe: null,
      recipeOverriddenBy: null,
      intent: { problem: 'greet says hello', outcome: 'it says hello by name', nonGoals: [] },
      context: {
        repos: [{ name: 'fixture', path: repo, lane: 1, baseBranch: 'main', headBranch: '' }],
        toolchain: {
          test: { command: 'echo ok', source: 'package.json' },
          lint: null,
          format: null,
          coverage: null,
          e2e: null,
          build: null,
        },
        entryPoints: [],
        priorArt: [],
        conventions: [],
        houseDocs: [],
      },
      acceptance: [
        {
          id: 'AC-1',
          statement: 'greet takes a name',
          priority: 'P1',
          verify: { kind: 'test', command: 'echo ok', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      risk: { grade: 'P3', triggers: [], blastRadius: ['README.md'], criticalPaths: [] },
      budgets: { agents: 1, wallClockMinutes: 60, filesTouched: 5, tokens: null },
      plan: {
        units: [
          {
            id: 'U-1',
            title: 'greet by name',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['README.md'],
            verify: [],
          },
        ],
        lanes: [{ ord: 1, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] }],
        sharedFiles: [],
      },
      assumptions: [],
      openQuestions: [],
      redTeam: [],
      provenance: { forgeSession: null, decisions: [], amendments: [] },
      createdAt: '2026-09-06T10:00:00.000Z',
      agreedAt: '2026-09-06T10:00:00.000Z',
    })
  )

  const started = (await foundry('foundry:run.start', { id })) as {
    error?: string
    started?: boolean
    graph?: { nodes: { id: string }[] }
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)
  expect(started.graph?.nodes.length).toBeGreaterThan(0)

  // The worktree became a project in the sidebar, named for the branch the
  // run cut — which is what makes it findable at all.
  const project = page.locator('.branch-row__name').filter({ hasText: 'wo-e2e-1' })
  await expect(project.first()).toBeVisible({ timeout: 60_000 })

  // And it is running in a terminal, with the command visible in it — held
  // until the tab mounted rather than printed before anything was listening.
  await project.first().click()
  const screen = page.locator('.xterm-screen')
  // The script's path is what is typed; the brief is far too long for a line.
  await expect(screen).toContainText('/launch/', { timeout: 60_000 })
  const launched = launchScriptFor((await screen.first().innerText()) ?? '')
  expect(launched).toContain('claude --session-id')

  // Never the thing this replaced: an invisible agent approving its own tool
  // calls.
  expect(launched).not.toContain('bypassPermissions')

  // A relative settings path resolves against the worktree, where it does not
  // exist, and the run dies on "Settings file not found" while the graph still
  // says running.
  expect(launched).toMatch(/--settings '\//)
  await expect(screen).not.toContainText('Settings file not found')

  // And it does not carry the parent Claude Code session in with it, which is
  // how an agent ends up waiting on somebody else's bridge for ever.
  expect(launched).toMatch(/^unset .*CLAUDE_CODE_BRIDGE_SESSION_ID/m)

  // The whole brief reached it, rather than the first kilobyte of it.
  expect(launched.length).toBeGreaterThan(1024)

  // The agent was told what to build, not merely who it is.
  const snapshot = (await foundry('foundry:supervision-snapshot')) as {
    runs: { sessionId: string; branch: string }[]
  }
  expect(snapshot.runs.length).toBeGreaterThan(0)
  expect(snapshot.runs[0].branch).toContain('wo-e2e-1')

  // The worktree is a real checkout of the fixture repository, cut under the
  // data root rather than inside the repository being worked on.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).toContain(join('.foundry', 'orders', id, 'worktrees', 'fixture'))
})
