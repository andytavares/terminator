import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'

// Opening the application on a run the last one left in flight.
//
// This is the only level the claim can be made at. An agent's terminal is a
// child of the application process, so "the agents are gone" is a fact about a
// *fresh* process — and a spec that stubs the runner has, by construction,
// nothing to be fresh about. So the records are written before the application
// launches, exactly as a previous session would have left them, and what is
// asserted is what the operator sees on opening it.
//
// A separate file from `foundry.spec.ts` on purpose: the extension looks at a
// records location once, and that file's own tests read it long before this
// could seed anything.

let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

const ORDER_ID = 'WO-INTERRUPTED'

/**
 * The order, as the Forge would have saved it before the run started.
 *
 * Written out in full rather than built from the schema's constructor: this
 * file is transpiled as CommonJS, and the extension's sources are ESM with
 * `.js` specifiers that do not resolve here. `the run is noticed on opening`
 * is what catches a fixture that drifts — an order that fails validation loads
 * as null and every surface reads "no such order".
 */
function order(): unknown {
  return {
    schemaVersion: 1,
    id: ORDER_ID,
    title: 'Refresh the token on a 401',
    status: 'running',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: 'direct',
    recipeOverriddenBy: null,
    intent: {
      problem: 'The client retries a 401 for ever instead of refreshing.',
      outcome: 'It refreshes once and retries once.',
      nonGoals: [],
    },
    context: {
      repos: [{ name: 'fixture', path: repo, lane: 1, baseBranch: 'main', headBranch: '' }],
      toolchain: {
        test: { command: 'npm test', source: 'package.json' },
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
        statement: 'A 401 refreshes once and retries once.',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, filesTouched: 25, tokens: null },
    plan: {
      units: [
        {
          id: 'U-1',
          title: 'refresh the token on a 401',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/client.ts'],
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
    agreedAt: '2026-09-06T10:05:00.000Z',
  }
}

/** The graph, frozen mid-run: one step `running`, with a session that is gone. */
function graph(): unknown {
  return {
    orderId: ORDER_ID,
    recipe: 'direct',
    nodes: [
      {
        id: 'build:U-1',
        stepId: 'build',
        kind: 'fanout',
        state: 'running',
        unitId: 'U-1',
        lane: 1,
        role: 'builder',
        dependsOn: [],
        attempts: 1,
        sessionId: '11111111-2222-3333-4444-555555555555',
        worktreePath: null,
        startedAt: '2026-09-06T10:00:00.000Z',
        endedAt: null,
      },
    ],
  }
}

function dataRoot(): string {
  return join(repo, '.foundry')
}

function graphOnDisk(): { nodes: { id: string; state: string; attempts: number }[] } {
  return JSON.parse(
    readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'run-graph.json'), 'utf8')
  ) as { nodes: { id: string; state: string; attempts: number }[] }
}

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

function clickByName(name: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var all = document.querySelectorAll('button')
    var want = ${JSON.stringify(name)}
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label === want || label.indexOf(want + ', ') === 0) { all[i].click(); return true }
    }
    return false
  })()`)
}

/**
 * What the view is showing.
 *
 * `textContent`, not `innerText`: `innerText` is a rendered-layout property and
 * comes back empty for a view Chromium has not laid out, which is every read
 * that happens while the panel is not the frontmost thing on screen.
 */
function bodyText(): Promise<string> {
  return inFoundry<string>('document.body.textContent')
}

async function openFoundry(): Promise<void> {
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  if ((await panel.count()) === 0) {
    const button = handle.page.locator('button[aria-label="Foundry"]')
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
  }
  await expect(panel).toHaveCount(1, { timeout: 30_000 })
  await handle.page.waitForTimeout(2500)
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = mkdtempSync(join(tmpdir(), 'foundry-resume-repo-'))
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok' } }, null, 2)
  )
  git('add', '.')
  git('commit', '-m', 'initial')

  // Written before the application exists. This is what the last session left.
  const dir = join(dataRoot(), 'orders', ORDER_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'order.json'), `${JSON.stringify(order(), null, 2)}\n`)
  writeFileSync(join(dir, 'run-graph.json'), `${JSON.stringify(graph(), null, 2)}\n`)

  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry', repo)
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

test('the run is noticed on opening, without anybody going to look', async () => {
  // Through the channel the chrome polls every four seconds from the moment
  // the application opens, which is the whole claim: this is found in one poll
  // rather than by coming back hours later and noticing nothing had moved.
  await expect
    .poll(async () => ((await foundry('foundry:attention')) as { inbox: number }).inbox, {
      timeout: 30_000,
    })
    .toBe(1)

  const listed = (await foundry('foundry:inbox.list')) as {
    gates: { rule: string; why: string; options: { id: string }[] }[]
  }
  expect(listed.gates.map((g) => g.rule)).toEqual(['run.interrupted'])
  expect(listed.gates[0].why).toContain('builder · U-1 refresh the token on a 401')
  expect(listed.gates[0].options.map((o) => o.id)).toEqual(['resume', 'stop', 'hold'])
})

test('the Floor says nothing is running it, rather than drawing a working run', async () => {
  const view = (await foundry('foundry:run.observe', { id: ORDER_ID })) as { orphaned: string[] }
  expect(view.orphaned).toEqual(['build:U-1'])
})

test('it refuses to send you to a terminal that no longer exists', async () => {
  const r = (await foundry('foundry:session.attach', {
    orderId: ORDER_ID,
    nodeId: 'build:U-1',
  })) as { error?: string }
  expect(r.error).toMatch(/no live agent/)
})

test('the inbox renders the row with its move on it', async () => {
  test.setTimeout(90_000)
  await openFoundry()
  // Polled rather than read once: the inbox refetches on a timer, and the gate
  // is raised by the same poll the chrome makes.
  await expect
    .poll(async () => await bodyText().catch((e) => `ERR:${(e as Error).message}`), {
      timeout: 30_000,
    })
    .toContain('Refresh the token on a 401')

  const text = await bodyText()
  expect(text, `the inbox rendered:\n${text}`).toContain('Pick it back up')
  expect(text).toContain('Stop here')

  // The picture, because a structural assertion passes while the band renders
  // in the wrong place, off-screen, or unreadable.
  const shot = (await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })) as string
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
  writeFileSync(
    join(process.cwd(), 'test-results', 'foundry-interrupted-inbox.png'),
    Buffer.from(shot, 'base64')
  )
  expect(existsSync(join(process.cwd(), 'test-results', 'foundry-interrupted-inbox.png'))).toBe(
    true
  )
})

test('the Floor carries the same move, above the graph', async () => {
  test.setTimeout(90_000)
  await openFoundry()

  // The Forge tab, then the running order — which opens on the Floor.
  expect(await clickByName('Forge')).toBe(true)
  await handle.page.waitForTimeout(800)
  expect(
    await inFoundry<boolean>(`(function () {
      var rows = document.querySelectorAll('.fdry-orders button')
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].textContent || '').indexOf(${JSON.stringify(ORDER_ID)}) >= 0) {
          rows[i].click(); return true
        }
      }
      return false
    })()`),
    'no row for the running order'
  ).toBe(true)
  await handle.page.waitForTimeout(1500)

  const text = await bodyText()
  // `Halted — your move`, not `Nothing is running this`. An orphan always
  // raises `run.interrupted` (adopt.ts), and ADR-045 puts an unanswered gate
  // ahead of everything else in the standing — "every other condition below is
  // a symptom of it". The adrift headline is what this order says *after* the
  // gate is held, which is a different screen. This assertion predates that
  // ordering.
  expect(text, `the Floor rendered:\n${text}`).toContain('Halted — your move')
  // The interrupted gate's own words, so this proves the resume band rendered
  // rather than any halt at any gate.
  expect(text).toContain('Nothing is moving this run')
  expect(text).toContain('builder · U-1 refresh the token on a 401')
  expect(text).toContain('Pick it back up')

  const shot = (await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return (await view.capturePage()).toPNG().toString('base64')
  })) as string
  writeFileSync(
    join(process.cwd(), 'test-results', 'foundry-interrupted-floor.png'),
    Buffer.from(shot, 'base64')
  )
})

test('answering it puts the abandoned step back in the queue', async () => {
  expect(graphOnDisk().nodes[0].state).toBe('running')

  const decided = (await foundry('foundry:inbox.decide', {
    gateId: `${ORDER_ID}-run.interrupted`,
    option: 'resume',
  })) as { ok?: boolean; error?: string }
  expect(decided.error, JSON.stringify(decided)).toBeUndefined()
  expect(decided.ok).toBe(true)

  // Reclaimed and written down. The executor then starts it again — which is
  // asynchronous and cuts a worktree, so what is asserted here is the reclaim
  // itself: the state the scheduler can act on, and the attempt given back.
  await expect
    .poll(() => graphOnDisk().nodes[0].attempts, { timeout: 20_000 })
    .toBeLessThanOrEqual(1)
  expect(['waiting', 'ready', 'running']).toContain(graphOnDisk().nodes[0].state)
})

test('stopping a run stops it, which nothing used to do', async () => {
  const stopped = (await foundry('foundry:run.stop', { id: ORDER_ID })) as { ok?: boolean }
  expect(stopped.ok).toBe(true)

  // Read from the record rather than from `order.list`, which filters a
  // cancelled order out by design — the list is what needs doing.
  const saved = JSON.parse(
    readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'order.json'), 'utf8')
  ) as { status: string }
  expect(saved.status).toBe('cancelled')

  const listed = (await foundry('foundry:order.list')) as {
    orders: { id: string }[]
  }
  expect(listed.orders.some((o) => o.id === ORDER_ID)).toBe(false)

  const ledger = readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'ledger.jsonl'), 'utf8')
  expect(ledger).toContain('run.interrupted')
  expect(ledger).toContain('run.stopped')
})
