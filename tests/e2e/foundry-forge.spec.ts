import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import { misalignedOn } from './control-alignment'
import { extensionPage } from './extension-page'
import {
  bodyText,
  captureFoundry,
  clickByName,
  fillByName,
  foundryChannel,
  hasAgentLaunchScript,
  inFoundry,
  listOrdersInForge,
  agentLaunchScript,
  makeFixtureRepo,
  openFoundry,
  openListedOrder,
  restartFoundry,
  createTypedOrder,
} from './foundry-harness'

// The Forge as one journey: an order opens as a frame, its budgets are set on the Plan
// step, records written by hand are read after a restart, the gate that stopped a run
// raises its budget, and an agreed order runs as a supervised agent in its own worktree.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = makeFixtureRepo('foundry-forge-repo-')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Forge', repo)
  await openFoundry(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

/** Clicks the Forge row whose visible text contains `id`, opening it. */
async function openOrderRow(id: string): Promise<void> {
  await listOrdersInForge(handle, id)
  await openListedOrder(handle, id)
}

/** The fixture repository, its toolchain and nothing else known about it. */
function fixtureContext(): unknown {
  return {
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
  }
}

/** One builder unit on one lane, satisfying AC-1 by touching README.md. */
function oneUnitPlan(): unknown {
  return {
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
  }
}

/** The order's one criterion, verified by a test that passes. */
const GREET_TAKES_A_NAME = {
  id: 'AC-1',
  statement: 'greet takes a name',
  priority: 'P1',
  verify: { kind: 'test', command: 'echo ok', assert: 'exit_code == 0' },
  unverifiable: null,
}

/** A complete, agreed order: what the Forge would have filled in. */
function agreedForgeOrder(id: string): unknown {
  return {
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
    context: fixtureContext(),
    acceptance: [GREET_TAKES_A_NAME],
    risk: { grade: 'P3', triggers: [], blastRadius: ['README.md'], criticalPaths: [] },
    budgets: { agents: 1, wallClockMinutes: 60, tokens: null },
    plan: oneUnitPlan(),
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: '2026-09-06T10:00:00.000Z',
    agreedAt: '2026-09-06T10:00:00.000Z',
  }
}

/** Starts the run, and checks it was accepted with something to run. */
async function startForgeRun(id: string): Promise<void> {
  const started = (await foundryChannel(handle, 'foundry:run.start', { id })) as {
    error?: string
    started?: boolean
    graph?: { nodes: { id: string }[] }
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)
  expect(started.graph?.nodes.length).toBeGreaterThan(0)
}

/** The agent's launch: supervised, with its settings and its whole brief, on its own. */
async function expectSupervisedLaunch(): Promise<void> {
  const screen = handle.page.locator('.xterm-screen')
  await expect.poll(() => hasAgentLaunchScript(handle), { timeout: 60_000 }).toBe(true)
  const launched = agentLaunchScript(handle)
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
}

const AGREED_ORDER = 'WO-E2E-1'

/** A complete order, written where the extension keeps its records. The Forge is what fills
 *  one in normally and has its own cover; what is under test is everything after it. */
function writeAgreedOrder(): void {
  const dir = join(repo, '.foundry', 'orders', AGREED_ORDER)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'order.json'), JSON.stringify(agreedForgeOrder(AGREED_ORDER)))
}

async function runLaunchesSupervisedAgent(): Promise<void> {
  await startForgeRun(AGREED_ORDER)

  // The worktree became a project in the sidebar, named for the branch the
  // run cut — which is what makes it findable at all.
  const project = handle.page.locator('.branch-row__name').filter({ hasText: 'wo-e2e-1' })
  await expect(project.first()).toBeVisible({ timeout: 60_000 })

  // And it is running in a terminal, with the launch script written — held
  // until the tab mounted rather than checked before anything was listening.
  await project.first().click()
  await expectSupervisedLaunch()

  // The agent was told what to build, not merely who it is.
  const branches = execFileSync('git', ['branch', '--list'], { cwd: repo }).toString()
  expect(branches).toContain('wo-e2e-1')

  // The worktree is a real checkout of the fixture repository, cut under the
  // data root rather than inside the repository being worked on.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).toContain(join('.foundry', 'orders', AGREED_ORDER, 'worktrees', 'fixture'))
}

/** Run in Foundry's view: where the controls that end an order are, and whether they are on screen. */
const END_CONTROLS = `(function () {
        var wanted = ['Discard this order', 'Delete this order']
        var out = {}
        var all = document.querySelectorAll('button')
        for (var i = 0; i < all.length; i++) {
          var label = (all[i].textContent || '').trim()
          if (wanted.indexOf(label) === -1) continue
          var r = all[i].getBoundingClientRect()
          out[label] = {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            inView: r.top >= 0 && r.bottom <= window.innerHeight,
          }
        }
        return out
      })()`

/** Both controls that end an order have rendered, and each is on screen. */
async function expectEndControlsOnScreen(timeout: number, offScreen: string): Promise<void> {
  const onScreen = (): Promise<Record<string, { inView: boolean }>> =>
    inFoundry(handle, END_CONTROLS)
  // Polled until both controls have rendered, rather than slept for a guessed
  // settle time.
  await expect
    .poll(async () => Object.keys(await onScreen()).sort(), { timeout })
    .toEqual(['Delete this order', 'Discard this order'])
  for (const [label, box] of Object.entries(await onScreen())) {
    expect(box.inView, `"${label}" ${offScreen}`).toBe(true)
  }
}

/** Run in Foundry's view: drives every scroller on the surface to its end. */
const SCROLL_EVERYTHING = `(function () {
      var all = document.querySelectorAll('*')
      for (var i = 0; i < all.length; i++) {
        if (all[i].scrollHeight > all[i].clientHeight) all[i].scrollTop = 1e6
      }
    })()`

/** Run in Foundry's view: the open step's height and the window's, or null before it draws. */
const STEP_SIZE = `(function () {
      var el = document.querySelector('section[aria-labelledby="fdry-step-h"]')
      if (!el) return null
      return { height: Math.round(el.getBoundingClientRect().height), viewport: window.innerHeight }
    })()`

/** The open step does not decide how long the page is: the frame bounds it, whatever it holds. */
async function expectStepWithinFrame(): Promise<void> {
  // The order's controls draw before the Forge has read the order ("Loading the order…"),
  // so the step is waited for, not read once after the controls appear.
  const step = () => inFoundry<{ height: number; viewport: number } | null>(handle, STEP_SIZE)
  await expect
    .poll(step, { timeout: 15_000, message: 'the Forge step did not render' })
    .not.toBeNull()
  const drawn = (await step()) as { height: number; viewport: number }
  expect(drawn.height).toBeLessThanOrEqual(drawn.viewport)
}

/** Runs `check` with the main window at `width` x `height`, restoring its size afterwards. */
async function withWindowSize(
  [width, height]: [number, number],
  check: () => Promise<void>
): Promise<void> {
  const before = await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  )
  await handle.app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
    [width, height]
  )
  try {
    await check()
  } finally {
    await handle.app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(size[0] as number, size[1] as number),
      before
    )
  }
}

async function openOrderIsAFrame(): Promise<void> {
  // Asserted as behaviour, not as a stylesheet: the controls are on screen before and after
  // everything that can scroll has scrolled to its end (docs/research/forge-shaping-redesign.md).
  const id = await createTypedOrder(handle, {
    repo,
    text: 'the frame keeps its controls at the foot',
    missing: 'no order was created to open',
  })
  // A window small enough that the rail cannot fit in it, the size the report came from.
  await withWindowSize([1305, 800], async () => {
    await openOrderRow(id)
    await expectEndControlsOnScreen(15_000, 'is off screen before anything is scrolled')
    // The half that used to fail: the controls were the last thing in the page's own scroll.
    await inFoundry(handle, SCROLL_EVERYTHING)
    await expectEndControlsOnScreen(10_000, 'scrolled off the screen')
    await expectStepWithinFrame()
    expect(
      await misalignedOn(await extensionPage(handle, 'terminator.foundry'), 'Forge order')
    ).toEqual([])
  })
}

async function budgetsOf(id: string): Promise<Record<string, number | null>> {
  const view = (await foundryChannel(handle, 'foundry:order.compile', { id })) as {
    order: { budgets: Record<string, number | null> }
  }
  return view.order.budgets
}

/** As the architect writes it: markdown in a question, its reason and an assumption. */
function writeMarkdownQuestion(id: string): void {
  const file = join(repo, '.foundry', 'orders', id, 'order.json')
  const order = JSON.parse(readFileSync(file, 'utf8'))
  order.openQuestions = [
    {
      id: 'Q-1',
      text: 'Hide **done** tickets from the picker?',
      why: 'The picker lists `completed` issues today.\n\n- Hide them\n- Grey them out',
      options: ['Hide *them*', 'Grey them out'],
      recommended: 0,
      answer: null,
      rank: 1,
      confidence: 0.6,
    },
  ]
  order.assumptions = [
    { id: 'A-1', text: 'The filter lives in `Orders.tsx`', struck: false, affects: [] },
  ]
  writeFileSync(file, JSON.stringify(order))
}

/** Run in Foundry's view: whether the markdown rendered, and no raw asterisk is left. */
const RENDERED_MARKDOWN = `(function () {
    function has(sel, text) {
      return Array.prototype.some.call(document.querySelectorAll(sel), function (el) {
        return el.textContent === text
      })
    }
    return {
      bold: has('strong', 'done'),
      code: has('code', 'completed'),
      list: has('li', 'Grey them out'),
      option: has('button em', 'them'),
      noAsterisks: document.body.innerText.indexOf('**') === -1,
    }
  })()`

async function markdownIsRendered(id: string): Promise<void> {
  await openOrderRow(id)
  await expect
    .poll(() => inFoundry<Record<string, boolean>>(handle, RENDERED_MARKDOWN), { timeout: 15_000 })
    .toEqual({ bold: true, code: true, list: true, option: true, noAsterisks: true })
  await captureFoundry(handle, 'forge-markdown.png')
}

/** Run in Foundry's view: clicks the Plan step, and says whether there was one. */
const CLICK_PLAN_STEP = `(function () {
    var all = document.querySelectorAll('nav[aria-label="Steps"] button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf('Plan') !== -1) { all[i].click(); return true }
    }
    return false
  })()`

/** Opens the order's Plan step, and waits for its budget fields. */
async function openPlanStep(): Promise<void> {
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          handle,
          `document.querySelector('nav[aria-label="Steps"] button') !== null`
        ),
      { timeout: 15_000 }
    )
    .toBe(true)

  const plan = await inFoundry<boolean>(handle, CLICK_PLAN_STEP)
  expect(plan, 'no Plan step').toBe(true)
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          handle,
          `document.querySelector('input[aria-label="Agents at once"]') !== null`
        ),
      {
        timeout: 10_000,
      }
    )
    .toBe(true)
}

/** Sets four agents at once and no limit on minutes, and saves. */
async function setBudgets(id: string): Promise<void> {
  // ADR 056: agents and minutes are the budgets; a count of files is not one.
  expect(
    await fillByName(handle, 'Files touched', '60'),
    'a files-touched field is still offered'
  ).toBe(false)
  expect(await fillByName(handle, 'Agents at once', '4'), 'no agents field').toBe(true)
  expect(
    await inFoundry<boolean>(
      handle,
      `(function () {
      var box = document.querySelector('input[aria-label="No limit on minutes"]')
      if (!box) return false
      box.click()
      return true
    })()`
    )
  ).toBe(true)
  expect(await clickByName(handle, 'button', 'Save budgets')).toBe(true)
  await expect
    .poll(() => budgetsOf(id), { timeout: 10_000 })
    .toMatchObject({
      agents: 4,
      wallClockMinutes: null,
    })
}

/** A gate the Line raised when the run had more agents going than it allows. */
function agentsBudgetGate(id: string) {
  return {
    id: `${id}-budget.exceeded-1`,
    rule: 'budget.exceeded',
    orderId: id,
    nodeId: null,
    summary: 'budgets are the operator’s to set has gone past its agents budget',
    why: 'The order budgets 4 and this run is at 6.',
    evidence: [],
    options: [
      { id: 'raise', label: 'Raise the budget', consequence: 'Work continues with more room.' },
      { id: 'stop', label: 'Stop here', consequence: 'The order is cancelled and reconciled.' },
      { id: 'hold', label: 'Hold', consequence: 'Nothing proceeds until you come back to it.' },
    ],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 1,
    riskGrade: 'P3',
    raisedAt: new Date().toISOString(),
    decision: null,
    breach: { kind: 'agents', limit: 4, actual: 6 },
  }
}

/** Raises the budget from the gate, and checks the order and the gate both say so. */
async function raiseAtGate(id: string, summary: string): Promise<void> {
  // The gate is in the band above the Forge.
  await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain(summary)
  expect(await clickByName(handle, 'button', 'Raise the budget')).toBe(true)
  await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain('At least 6.')

  expect(await fillByName(handle, 'Agents at once', '8')).toBe(true)
  expect(await clickByName(handle, 'button', 'Raise and resume')).toBe(true)
  await expect.poll(async () => (await budgetsOf(id)).agents, { timeout: 10_000 }).toBe(8)
  const decided = JSON.parse(
    readFileSync(join(repo, '.foundry', 'orders', id, 'gates.json'), 'utf8')
  ) as { decision: { option: string } | null }[]
  expect(decided[0].decision?.option).toBe('raise')
}

async function budgetsSetOnPlan(): Promise<string> {
  const id = await createTypedOrder(handle, {
    repo,
    text: 'budgets are the operator’s to set',
    missing: 'no order was created',
  })
  await openOrderRow(id)
  await openPlanStep()
  await setBudgets(id)
  return id
}

/** Writes what an architect and the Line would have left on disk, and restarts: Foundry
 *  reads its records once, as an operator who edited them would find. */
async function writeRecordsAndRestart(
  budgeted: string
): Promise<{ markdown: string; gate: string }> {
  const markdown = await createTypedOrder(handle, {
    repo,
    text: 'markdown in the forge',
    missing: 'no order was created to open',
  })
  writeMarkdownQuestion(markdown)
  const gate = agentsBudgetGate(budgeted)
  writeFileSync(join(repo, '.foundry', 'orders', budgeted, 'gates.json'), JSON.stringify([gate]))
  writeAgreedOrder()
  handle = await restartFoundry(handle, 'Foundry Forge')
  return { markdown, gate: gate.summary }
}

async function budgetRaisedAtGate(id: string, summary: string): Promise<void> {
  await openOrderRow(id)
  await raiseAtGate(id, summary)
}

test('an open order is a frame whose budgets are set on Plan and raised at the gate, and an agreed order runs as a supervised agent', async () => {
  test.setTimeout(240_000)
  const step = test.step
  await step(
    'an open order is a frame, and the controls that end it never scroll away',
    openOrderIsAFrame
  )
  const budgeted = await step('an order’s budgets are set on the Plan step', budgetsSetOnPlan)
  const written = await step('records written by hand are read after a restart', () =>
    writeRecordsAndRestart(budgeted)
  )
  await step('what the architect writes is shown as markdown in the Forge', () =>
    markdownIsRendered(written.markdown)
  )
  await step('an order’s budgets are raised at the gate that stopped it', () =>
    budgetRaisedAtGate(budgeted, written.gate)
  )
  await step(
    'a run cuts a worktree and launches a supervised agent in a visible terminal',
    runLaunchesSupervisedAgent
  )
})
