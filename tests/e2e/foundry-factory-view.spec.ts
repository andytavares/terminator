import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  bodyText,
  captureFoundry,
  clickByName,
  clickContaining,
  hasStation,
  makeFixtureRepo,
  openFoundry,
  openForge,
  pressedByLabel,
  stationCount,
} from './foundry-harness'

// The Forge's List ⇄ Factory toggle, driven through the running application.
//
// The extension's UI is an overlaid WebContentsView — Playwright's `page`
// cannot see it — so this reaches it the same way tests/e2e/foundry-*.spec.ts
// does: `electronApp.evaluate` over `getAllWebContents`, and every control is
// addressed by role and accessible name, never by CSS class.
//
// Each test below launches and closes its own app: neither depends on what
// the other left running, so either passes run alone.

test.describe('the List/Factory toggle', () => {
  let handle: AppHandle
  let repo: string

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    repo = makeFixtureRepo('foundry-factory-toggle-')
    handle = await launchApp()
    await createWorkspace(handle.page, 'Foundry Factory Toggle', repo)
    await openFoundry(handle)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
  })

  test('switches the Forge, survives a restart, and switches back', async () => {
    await openForge(handle)

    // Default is List: the toggle group exists and List is pressed.
    await expect.poll(() => pressedByLabel(handle, 'List view'), { timeout: 15_000 }).toBe('true')
    expect(await pressedByLabel(handle, 'Factory view')).toBe('false')

    // Press Factory.
    expect(await clickByName(handle, 'button', 'Factory view')).toBe(true)
    await expect
      .poll(() => pressedByLabel(handle, 'Factory view'), { timeout: 10_000 })
      .toBe('true')
    expect(await pressedByLabel(handle, 'List view')).toBe('false')

    // The factory surface actually rendered something (the site, empty or not).
    await expect
      .poll(async () => (await bodyText(handle)).length, { timeout: 10_000 })
      .toBeGreaterThan(0)

    // Screenshot the factory surface for a human to look at.
    await captureFoundry(handle, 'foundry-factory-view.png')

    // Relaunch on the same profile: the preference is per-operator, not per-run.
    const userDataDir = handle.userDataDir
    await closeApp(handle)
    handle = await launchApp(userDataDir)
    await openFoundry(handle)
    await openForge(handle)

    await expect
      .poll(() => pressedByLabel(handle, 'Factory view'), { timeout: 15_000 })
      .toBe('true')
    expect(await pressedByLabel(handle, 'List view')).toBe('false')

    // Toggle back to List.
    expect(await clickByName(handle, 'button', 'List view')).toBe(true)
    await expect.poll(() => pressedByLabel(handle, 'List view'), { timeout: 10_000 }).toBe('true')
    expect(await pressedByLabel(handle, 'Factory view')).toBe('false')
    await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain('New order')
  })
})

// ---------------------------------------------------------------------------
// A real hall: a running order, seeded on disk exactly as tests/e2e/
// foundry-resume.spec.ts seeds one — records under `<repo>/.foundry/`, not
// through the app — so the Factory view has an actual run graph to draw
// rather than the empty site.
// ---------------------------------------------------------------------------

test.describe('a real hall', () => {
  let handle: AppHandle
  let repo: string

  const HALL_ORDER_ID = 'WO-FACTORY-HALL'

  function dataRoot(): string {
    return join(repo, '.foundry')
  }

  /** A running order, agreed and mid-run, with two build lanes. */
  function hallOrder(): unknown {
    return {
      schemaVersion: 1,
      id: HALL_ORDER_ID,
      title: 'Add retry backoff to the sync job',
      status: 'running',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      writeBack: [],
      stateMapping: { started: null, in_review: null, done: null },
      recipe: 'standard',
      recipeOverriddenBy: null,
      intent: {
        problem: 'The sync job retries immediately and hammers the API on an outage.',
        outcome: 'It backs off exponentially and gives up after five tries.',
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
          statement: 'A failed sync retries with exponential backoff up to five times.',
          priority: 'P1',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
      budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
      plan: {
        units: [
          {
            id: 'U-1',
            title: 'back off, lane 1',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/sync.ts'],
            verify: [],
          },
          {
            id: 'U-2',
            title: 'back off, lane 2',
            role: 'builder',
            lane: 2,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/sync2.ts'],
            verify: [],
          },
        ],
        lanes: [
          { ord: 1, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
          { ord: 2, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
        ],
        sharedFiles: [],
      },
      assumptions: [],
      openQuestions: [],
      redTeam: [],
      provenance: { forgeSession: null, decisions: [], amendments: [] },
      createdAt: '2026-09-25T10:00:00.000Z',
      agreedAt: '2026-09-25T10:05:00.000Z',
    }
  }

  interface HallNodeSpec {
    readonly id: string
    readonly stepId: string
    readonly kind: 'agent' | 'run' | 'judge' | 'gate' | 'fanout' | 'join'
    readonly state: string
    readonly lane: number | null
    readonly role: string | null
    readonly dependsOn: readonly string[]
    readonly attempts: number
    readonly sessionId?: string | null
  }

  function graphNode(spec: HallNodeSpec): unknown {
    const finished = spec.state === 'passed' || spec.state === 'failed' || spec.state === 'skipped'
    return {
      id: spec.id,
      stepId: spec.stepId,
      kind: spec.kind,
      state: spec.state,
      unitIds: [],
      lane: spec.lane,
      role: spec.role,
      dependsOn: spec.dependsOn,
      attempts: spec.attempts,
      sessionId: spec.sessionId ?? null,
      worktreePath: null,
      startedAt: spec.state === 'waiting' ? null : '2026-09-25T10:00:00.000Z',
      endedAt: finished ? '2026-09-25T10:10:00.000Z' : null,
    }
  }

  /**
   * The graph, frozen mid-run: an architect done, two build lanes (one still
   * `running`, with a session nothing in this process is running — the
   * Factory view must draw it orphaned, "no agent", not faked as live), a
   * verifier per lane, a judge, a join and a gate.
   */
  function hallGraph(): unknown {
    return {
      orderId: HALL_ORDER_ID,
      recipe: 'standard',
      nodes: [
        graphNode({
          id: 'architect',
          stepId: 'architect',
          kind: 'agent',
          state: 'passed',
          lane: null,
          role: 'architect',
          dependsOn: [],
          attempts: 1,
        }),
        graphNode({
          id: 'build:lane1',
          stepId: 'build',
          kind: 'fanout',
          state: 'running',
          lane: 1,
          role: 'builder',
          dependsOn: ['architect'],
          attempts: 1,
          sessionId: '11111111-2222-3333-4444-555555555555',
        }),
        graphNode({
          id: 'build:lane2',
          stepId: 'build',
          kind: 'fanout',
          state: 'passed',
          lane: 2,
          role: 'builder',
          dependsOn: ['architect'],
          attempts: 1,
        }),
        graphNode({
          id: 'verify:lane1',
          stepId: 'verify',
          kind: 'run',
          state: 'waiting',
          lane: 1,
          role: 'verifier',
          dependsOn: ['build:lane1'],
          attempts: 0,
        }),
        graphNode({
          id: 'verify:lane2',
          stepId: 'verify',
          kind: 'run',
          state: 'ready',
          lane: 2,
          role: 'verifier',
          dependsOn: ['build:lane2'],
          attempts: 0,
        }),
        graphNode({
          id: 'judge',
          stepId: 'judge',
          kind: 'judge',
          state: 'waiting',
          lane: null,
          role: 'inspector',
          dependsOn: ['verify:lane1', 'verify:lane2'],
          attempts: 0,
        }),
        graphNode({
          id: 'join',
          stepId: 'join',
          kind: 'join',
          state: 'waiting',
          lane: null,
          role: 'integrator',
          dependsOn: ['judge'],
          attempts: 0,
        }),
        graphNode({
          id: 'gate',
          stepId: 'gate',
          kind: 'gate',
          state: 'waiting',
          lane: null,
          role: null,
          dependsOn: ['join'],
          attempts: 0,
        }),
      ],
    }
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    repo = makeFixtureRepo('foundry-factory-hall-')

    const dir = join(dataRoot(), 'orders', HALL_ORDER_ID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'order.json'), `${JSON.stringify(hallOrder(), null, 2)}\n`)
    writeFileSync(join(dir, 'run-graph.json'), `${JSON.stringify(hallGraph(), null, 2)}\n`)
    // What the recorder writes beside the graph as a run goes: two frames, the
    // architect working and then done, for the replay to play back.
    const seeded = hallGraph() as {
      nodes: { id: string; attempts: number; sessionId: string | null }[]
    }
    const frame = (at: number, architect: string): string =>
      JSON.stringify({
        kind: 'graph',
        at,
        nodes: seeded.nodes.map((n, i) => ({
          id: n.id,
          state: i === 0 ? architect : 'waiting',
          attempts: n.attempts,
          sessionId: n.sessionId,
        })),
      })
    writeFileSync(
      join(dir, 'run-timeline.jsonl'),
      `${frame(Date.now() - 60_000, 'running')}\n${frame(Date.now() - 50_000, 'passed')}\n`
    )

    handle = await launchApp()
    await createWorkspace(handle.page, 'Foundry Factory Hall', repo)
    await openFoundry(handle)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
  })

  test('draws a real hall: one station per run-graph node, the orphaned one dark', async () => {
    await openForge(handle)
    expect(await clickByName(handle, 'button', 'Factory view')).toBe(true)
    await expect
      .poll(() => pressedByLabel(handle, 'Factory view'), { timeout: 10_000 })
      .toBe('true')

    await expect
      .poll(() => clickContaining(handle, 'button', 'Add retry backoff to the sync job'), {
        timeout: 20_000,
      })
      .toBe(true)

    // One station button per run-graph node — the honesty rule: every node gets
    // a place in the hall whether or not anything is really running it.
    await expect.poll(() => stationCount(handle), { timeout: 15_000 }).toBe(8)

    // Every node, addressed exactly as `FactoryHall.tsx` labels a station: its
    // label, its role (or "unassigned"), the word `stateWord()` renders for its
    // `NodeState` (or "no agent" for an orphaned one), and its attempt count.
    // `build:lane1` is `running` with a session nothing in this process is
    // running: the orphaned treatment is the label itself — "no agent" — not a
    // crew member drawn on a canvas nothing is actually driving.
    const expectedStations = [
      'architect, architect, Done, attempt 1',
      'builder, builder, no agent, attempt 1',
      'builder, builder, Done, attempt 1',
      'verifier, verifier, Queued, attempt 0',
      'verifier, verifier, Ready, attempt 0',
      'inspector, inspector, Queued, attempt 0',
      'integrator, integrator, Queued, attempt 0',
      'gate, unassigned, Queued, attempt 0',
    ]
    for (const label of expectedStations) {
      await expect.poll(() => hasStation(handle, label), `no station "${label}"`).toBe(true)
    }

    await captureFoundry(handle, 'foundry-factory-hall.png')

    // The recording plays back in the same hall.
    expect(await clickByName(handle, 'button', 'Replay')).toBe(true)
    await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain('Back to live')
    await captureFoundry(handle, 'foundry-factory-replay.png')
    expect(await clickByName(handle, 'button', 'Back to live')).toBe(true)
    await expect.poll(() => bodyText(handle), { timeout: 10_000 }).not.toContain('Back to live')
  })
})
