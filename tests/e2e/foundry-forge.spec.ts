import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  bodyText,
  captureFoundry,
  clickByName,
  fillByName,
  foundryChannel,
  hasLaunchScript,
  inFoundry,
  launchScript,
  makeFixtureRepo,
  openFoundry,
} from './foundry-harness'

// The Forge: opening an order, running it, and the controls that manage its
// budgets.
//
// Split out of what used to be `foundry.spec.ts` (see
// docs/research/e2e-deterministic-selective.md) — this file's own app and
// fixture repo, and every test seeds its own order and navigates to it
// itself, rather than relying on what an earlier test left on screen.

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
  expect(await clickByName(handle, 'button', 'Forge')).toBe(true)
  await expect
    .poll(() => bodyText(handle), { timeout: 15_000 })
    .toMatch(/New order|Steps|All orders/)
  // An earlier order may already be open; get back to the list first.
  await clickByName(handle, 'button', 'All orders')
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          handle,
          `(function () {
        var all = document.querySelectorAll('button')
        for (var i = 0; i < all.length; i++) {
          if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) return true
        }
        return false
      })()`
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
  const opened = await inFoundry<boolean>(
    handle,
    `(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf(${JSON.stringify(id)}) !== -1) {
        all[i].click()
        return true
      }
    }
    return false
  })()`
  )
  expect(opened, `no row for ${id} in the Forge`).toBe(true)
}

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
      budgets: { agents: 1, wallClockMinutes: 60, tokens: null },
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

  const started = (await foundryChannel(handle, 'foundry:run.start', { id })) as {
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

  // And it is running in a terminal, with the launch script written — held
  // until the tab mounted rather than checked before anything was listening.
  await project.first().click()
  const screen = page.locator('.xterm-screen')
  await expect.poll(() => hasLaunchScript(handle), { timeout: 60_000 }).toBe(true)
  const launched = launchScript(handle)
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
  const snapshot = (await foundryChannel(handle, 'foundry:supervision-snapshot')) as {
    runs: { sessionId: string; branch: string }[]
  }
  expect(snapshot.runs.length).toBeGreaterThan(0)
  expect(snapshot.runs[0].branch).toContain('wo-e2e-1')

  // The worktree is a real checkout of the fixture repository, cut under the
  // data root rather than inside the repository being worked on.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).toContain(join('.foundry', 'orders', id, 'worktrees', 'fixture'))
})

test('an open order is a frame, and the controls that end it never scroll away', async () => {
  // What this is about, in the operator's words: "use of space is terrible, I
  // have to scroll so far to find the delete/discard button. Why the hell are
  // there so many cards on the left side and we have nothing on the right for
  // most of the screen."
  //
  // Both halves were one fault. The Forge's rail is controls and its document
  // is the subject, and neither was bounded — measured on the reported order
  // at the reported window (1005x768), the rail came out 1494px beside a
  // 1906px document in a 729px viewport, so the page was 2383px long, two
  // thirds of the width was empty for the stretch where only the rail was
  // left, and the controls that end an order — which render after both
  // columns — sat at 2367px. 1654px of scrolling to reach a button.
  //
  // Asserted as behaviour rather than as a stylesheet: the controls are on
  // screen before anything is scrolled, and still on screen after everything
  // that can scroll has been scrolled to its end.
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'the frame keeps its controls at the foot' },
    repoPaths: [repo],
  })) as { order?: { id: string } }
  const id = created.order?.id
  expect(id, 'no order was created to open').toBeTruthy()

  // A window small enough that the rail cannot fit in it, which is the whole
  // point — and the size the report came from. Restored afterwards, because
  // every test in this file shares one application.
  const before = await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  )
  await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1305, 800)
  )

  try {
    await openOrderRow(id as string)

    const onScreen = (): Promise<Record<string, unknown>> =>
      inFoundry(
        handle,
        `(function () {
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
      )

    // Nothing scrolled yet: the operator has just opened the order. Polled
    // until both controls have rendered, rather than slept for a guessed
    // settle time.
    await expect
      .poll(async () => Object.keys((await onScreen()) as Record<string, unknown>).sort(), {
        timeout: 15_000,
      })
      .toEqual(['Delete this order', 'Discard this order'])
    const resting = (await onScreen()) as Record<string, { inView: boolean }>
    for (const [label, box] of Object.entries(resting)) {
      expect(box.inView, `"${label}" is off screen before anything is scrolled`).toBe(true)
    }

    // And after every scroller on the surface has been driven to its end —
    // the rail, the document, the frame. This is the half that used to fail:
    // the controls were the last thing in the page's own scroll.
    await inFoundry(
      handle,
      `(function () {
      var all = document.querySelectorAll('*')
      for (var i = 0; i < all.length; i++) {
        if (all[i].scrollHeight > all[i].clientHeight) all[i].scrollTop = 1e6
      }
    })()`
    )

    await expect
      .poll(async () => Object.keys((await onScreen()) as Record<string, unknown>).sort(), {
        timeout: 10_000,
      })
      .toEqual(['Delete this order', 'Discard this order'])
    const scrolled = (await onScreen()) as Record<string, { inView: boolean }>
    for (const [label, box] of Object.entries(scrolled)) {
      expect(box.inView, `"${label}" scrolled off the screen`).toBe(true)
    }

    // The open step does not decide how long the page is. It is bounded by the
    // frame, whatever it holds.
    const step = await inFoundry<{ height: number; viewport: number } | null>(
      handle,
      `(function () {
      var el = document.querySelector('.fdry-main')
      if (!el) return null
      return { height: Math.round(el.getBoundingClientRect().height), viewport: window.innerHeight }
    })()`
    )
    expect(step, 'the Forge step did not render').not.toBeNull()
    expect(step && step.height).toBeLessThanOrEqual((step as { viewport: number }).viewport)
  } finally {
    await handle.app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(size[0] as number, size[1] as number),
      before
    )
  }
})

async function budgetsOf(id: string): Promise<Record<string, number | null>> {
  const view = (await foundryChannel(handle, 'foundry:order.compile', { id })) as {
    order: { budgets: Record<string, number | null> }
  }
  return view.order.budgets
}

// The operator could not see or change an order's budgets, and "Raise the
// budget" resumed the run against the budget it had just gone past. Both are
// read back from the order the running application saved, not from the call.
test('what the architect writes is shown as markdown in the Forge', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'markdown in the forge' },
    repoPaths: [repo],
  })) as { order?: { id: string } }
  const id = created.order?.id as string
  expect(id, 'no order was created to open').toBeTruthy()

  // As the architect writes it: markdown in a question, its reason and an
  // assumption.
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

  await openOrderRow(id)

  await expect
    .poll(
      () =>
        inFoundry<Record<string, boolean>>(
          handle,
          `(function () {
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
        ),
      { timeout: 15_000 }
    )
    .toEqual({ bold: true, code: true, list: true, option: true, noAsterisks: true })

  await captureFoundry(handle, 'forge-markdown.png')
})

test('an order’s budgets are set on the Plan step, and raised at the gate that stopped it', async () => {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'budgets are the operator’s to set' },
    repoPaths: [repo],
  })) as { order?: { id: string } }
  const id = created.order?.id as string
  expect(id, 'no order was created').toBeTruthy()

  await openOrderRow(id)
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

  const plan = await inFoundry<boolean>(
    handle,
    `(function () {
    var all = document.querySelectorAll('nav[aria-label="Steps"] button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf('Plan') !== -1) { all[i].click(); return true }
    }
    return false
  })()`
  )
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

  // A gate the Line raised when the run had more agents going than it allows.
  const gate = {
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
  writeFileSync(join(repo, '.foundry', 'orders', id, 'gates.json'), JSON.stringify([gate]))

  expect(await clickByName(handle, 'button', 'Inbox')).toBe(true)
  await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain(gate.summary)
  expect(await clickByName(handle, 'button', 'Raise the budget')).toBe(true)
  await expect.poll(() => bodyText(handle), { timeout: 10_000 }).toContain('At least 6.')

  expect(await fillByName(handle, 'Agents at once', '8')).toBe(true)
  expect(await clickByName(handle, 'button', 'Raise and resume')).toBe(true)
  await expect.poll(async () => (await budgetsOf(id)).agents, { timeout: 10_000 }).toBe(8)
  const decided = JSON.parse(
    readFileSync(join(repo, '.foundry', 'orders', id, 'gates.json'), 'utf8')
  ) as { decision: { option: string } | null }[]
  expect(decided[0].decision?.option).toBe('raise')
})
