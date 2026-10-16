import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  inExtensionView,
  projectGroup,
  runQuickActionFromPanel,
  type AppHandle,
} from './helpers'
import {
  bodyText,
  clickByName,
  foundryChannel,
  hasAgentLaunchScript,
  agentLaunchScript,
  inFoundry,
  makeFixtureRepo,
  openFoundry,
} from './foundry-harness'

// Foundry's intake path as one journey: Quick Actions opens the Forge, an idea becomes an
// order, and a draft's architect launches in its own worktree. `claude` is the stub
// `launchApp` puts on PATH, so the launch is under test, never a model.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = makeFixtureRepo('foundry-intake-repo-')
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Intake', repo)
  await projectGroup(handle.page, 'main').click()
  await expect(handle.page.getByRole('textbox', { name: 'Terminal input' }).first()).toBeVisible({
    timeout: 15_000,
  })
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

/** What has focus in Foundry's frame: an input's placeholder, or the element's tag. */
function focusedInFoundry(): Promise<string> {
  return inExtensionView<string>(
    handle,
    'terminator.foundry',
    `(document.activeElement && (document.activeElement.getAttribute('placeholder') || document.activeElement.tagName)) || ''`
  ).catch(() => '')
}

async function newWorkOrderFromQuickActions(): Promise<void> {
  await runQuickActionFromPanel(handle.page, 'New work order…')
  await expect(handle.page.locator('[data-extension-panel="terminator.foundry"]')).toHaveCount(1, {
    timeout: 30_000,
  })
  await expect
    .poll(focusedInFoundry, { timeout: 15_000 })
    .toBe('Describe what you want built or fixed…')
}

async function extensionAnswers(): Promise<void> {
  // If this rejects, the extension did not activate and every later step
  // would fail for a reason that has nothing to do with what it checks.
  await openFoundry(handle)
  const orders = (await foundryChannel(handle, 'foundry:order.list')) as { orders?: unknown[] }
  expect(Array.isArray(orders.orders)).toBe(true)
}

async function chromeCountsWhatIsWaiting(): Promise<void> {
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

  // The badge is drawn from it, or not drawn when there is nothing to say.
  // The queue sits above the Forge, so both counts land on the Forge's tab.
  const badges = await inFoundry<number>(
    handle,
    `document.querySelectorAll('.fdry-tab-count').length`
  )
  expect(badges).toBe(counts.inbox === 0 && counts.forge === 0 ? 0 : 1)
}

async function everySurfaceRenders(): Promise<void> {
  // The Forge is home: it is what is on screen before anything is clicked.
  await expect.poll(() => bodyText(handle), { timeout: 15_000 }).toContain('New order')
  expect(
    await inFoundry<string | null>(
      handle,
      `(document.querySelector('button[aria-pressed="true"]') || {}).textContent || null`
    )
  ).toBe('Forge')
  // Identified by something the surface always shows, not by its empty state.
  for (const [tab, expected] of [
    ['Ledger', 'What do I keep rejecting?'],
    ['Forge', 'New order'],
  ] as const) {
    expect(await clickByName(handle, 'button', tab), `no control named "${tab}"`).toBe(true)
    await expect.poll(() => bodyText(handle), { timeout: 15_000 }).toContain(expected)
  }
  await settingsRendersAndGoesBack()
}

async function settingsRendersAndGoesBack(): Promise<void> {
  // The settings control draws only an icon, so it is addressed by its label.
  // `innerText` reflects `text-transform`, so a phrase is matched, not the heading.
  expect(await clickByName(handle, 'button', 'Settings')).toBe(true)
  await expect
    .poll(() => bodyText(handle), { timeout: 15_000 })
    .toContain('Use my Claude Code default')
  expect(await clickByName(handle, 'button', 'Back')).toBe(true)
}

async function ideaBecomesAnOrder(): Promise<void> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'rows are clipped at the right edge of src/terminal/row.ts' },
    repoPaths: [repo],
  })) as { order?: { id: string; status: string }; error?: string }
  expect(created.error).toBeUndefined()
  expect(created.order?.status).toBe('draft')

  const listed = (await foundryChannel(handle, 'foundry:order.list')) as {
    orders: { id: string }[]
  }
  expect(listed.orders.map((o) => o.id)).toContain(created.order?.id)
}

/** Run in Foundry's view: how tall the page is, and how tall the window. */
const PAGE_HEIGHT = '({ scroll: document.documentElement.scrollHeight, view: window.innerHeight })'

async function orderFitsTheView(): Promise<void> {
  // The rail was 260px whatever the window, so stacked panels ran past the
  // bottom while the order beside them left two thirds of the width empty.
  await expect.poll(() => clickByName(handle, 'button', 'Forge')).toBe(true)
  await expect
    .poll(
      () => inFoundry<number>(handle, `document.querySelectorAll('.fdry-orders button').length`),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0)
  const size = await inFoundry<{ scroll: number; view: number }>(handle, PAGE_HEIGHT)
  expect(size.scroll, 'the Forge needs scrolling to show one order').toBeLessThanOrEqual(
    size.view + 8
  )
}

/** Run in Foundry's view: the heights of the children of every seed and input row. */
const ROW_HEIGHTS = `(function () {
    var out = {}
    var rows = document.querySelectorAll('.fdry-seed, .fdry-input')
    for (var i = 0; i < rows.length; i++) {
      var heights = []
      for (var j = 0; j < rows[i].children.length; j++) {
        heights.push(Math.round(rows[i].children[j].getBoundingClientRect().height * 100) / 100)
      }
      out[rows[i].className + ' ' + i] = heights
    }
    return out
  })()`

async function rowControlsShareOneHeight(): Promise<void> {
  // Fields got one height in the shared stylesheet and buttons did not, so a
  // stretched row left a 28px field between two 34px buttons.
  await expect
    .poll(() => inFoundry<number>(handle, `document.querySelectorAll('.fdry-seed > *').length`))
    .toBeGreaterThan(2)
  const rows = await inFoundry<Record<string, number[]>>(handle, ROW_HEIGHTS)
  for (const [row, heights] of Object.entries(rows)) {
    expect(new Set(heights).size, `${row}: ${heights.join(', ')}`).toBe(1)
  }
}

/** Run in Foundry's view: every element whose own text renders at 16px or more,
 *  the untouched browser default. A container is not blamed for a child's text. */
const OVERSIZED_TEXT = `(function () {
    var out = []
    var all = document.querySelectorAll('body *')
    for (var i = 0; i < all.length; i++) {
      var own = ''
      for (var j = 0; j < all[i].childNodes.length; j++) {
        if (all[i].childNodes[j].nodeType === 3) own += all[i].childNodes[j].textContent
      }
      if (own.trim() === '') continue
      var size = parseFloat(getComputedStyle(all[i]).fontSize)
      if (size >= 16) out.push(all[i].tagName.toLowerCase() + '.' + String(all[i].className || '') + ' "' + own.trim().slice(0, 40) + '" ' + size)
    }
    return out
  })()`

async function noTextAtTheDefaultSize(): Promise<void> {
  // The shared stylesheet sets no body size, so a rule that forgets one lands
  // on 16px beside a product drawn at 11-13px.
  const found: string[] = []
  for (const [surface, shows] of [
    ['Ledger', 'What do I keep rejecting?'],
    ['Forge', 'New order'],
  ] as const) {
    expect(await clickByName(handle, 'button', surface)).toBe(true)
    await expect.poll(() => bodyText(handle), { timeout: 15_000 }).toContain(shows)
    for (const item of await inFoundry<string[]>(handle, OVERSIZED_TEXT)) {
      found.push(`${surface}: ${item}`)
    }
  }
  expect(found, 'these render at the untouched 16px default').toEqual([])
}

async function nothingThrew(): Promise<void> {
  expect(await inFoundry<string[]>(handle, 'window.__thrown || []')).toEqual([])
}

async function repositoryReadFirst(): Promise<void> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'the lint command is wrong' },
    repoPaths: [repo],
  })) as { order: { context: { toolchain: Record<string, unknown> } }; unavailableChecks: string[] }
  // The fixture declares `test` and `lint`, so those are probed and the rest
  // are honestly reported as unmeasurable here.
  expect(created.order.context.toolchain.test).toMatchObject({ source: 'package.json' })
  expect(created.unavailableChecks).toContain('coverage')
}

async function createDraft(text: string): Promise<string> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text },
    repoPaths: [repo],
  })) as { order: { id: string } }
  return created.order.id
}

async function incompleteOrderRefused(): Promise<void> {
  const id = await createDraft('something vague')
  const compiled = (await foundryChannel(handle, 'foundry:order.compile', {
    id,
    commit: true,
  })) as { order: { status: string }; compile: { ok: boolean; failures: { check: string }[] } }
  expect(compiled.compile.ok).toBe(false)
  expect(compiled.order.status).toBe('draft')
  expect(compiled.compile.failures.length).toBeGreaterThan(0)
}

async function noRunWithoutAgreement(): Promise<void> {
  const id = await createDraft('start me without agreeing')
  const started = (await foundryChannel(handle, 'foundry:run.start', { id })) as {
    error?: string
  }
  expect(started.error).toBeDefined()
}

async function ledgerIsAttributable(): Promise<void> {
  await createDraft('something to record')
  const record = (await foundryChannel(handle, 'foundry:ledger.query', {})) as {
    entries: { actor: string; action: string }[]
    actions: string[]
  }
  expect(record.actions).toContain('order.seeded')
  for (const entry of record.entries) {
    expect(entry.actor, 'an unattributed entry is not a record of a decision').not.toBe('')
    expect(entry.action).not.toBe('')
  }
}

async function curatorProposesNothing(): Promise<void> {
  await createDraft('nothing repeated here')
  const proposals = (await foundryChannel(handle, 'foundry:rules.propose', {})) as {
    proposals: unknown[]
  }
  expect(proposals.proposals).toEqual([])
}

async function repositoryUntouched(): Promise<void> {
  // The one thing Foundry may leave is its own records directory at the
  // default location (ADR-042). No modified, deleted or other new file, and
  // above all no `.gitignore` entry.
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString()
  const left = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== '?? .foundry/')
  expect(left, `Foundry left files behind:\n${status}`).toEqual([])
  const ignore = execFileSync('git', ['ls-files', '.gitignore'], { cwd: repo }).toString()
  expect(ignore.trim(), 'Foundry created a .gitignore').toBe('')
}

/** The architect was launched as an interactive, permission-asking session of its own. */
async function expectReadOnlyLaunch(): Promise<void> {
  // What the launch wrote, not the terminal's scrollback, which a talkative
  // agent scrolls out of view.
  await expect.poll(() => hasAgentLaunchScript(handle), { timeout: 60_000 }).toBe(true)
  const launched = agentLaunchScript(handle)
  expect(launched).toContain('claude --session-id')
  expect(launched).not.toContain('bypassPermissions')
  // A relative settings path resolves against the worktree, where it does not exist.
  expect(launched).toMatch(/--settings '\//)
  // And it does not carry the parent Claude Code session in with it.
  expect(launched).toMatch(/^unset .*CLAUDE_CODE_BRIDGE_SESSION_ID/m)
}

interface ConvergedOrder {
  id: string
  branch: string
}

/** Seeds a draft, asks intake to converge it, and returns its id and branch. */
async function convergeADraft(): Promise<ConvergedOrder> {
  const created = (await foundryChannel(handle, 'foundry:order.create', {
    source: { kind: 'typed', text: 'greet should take a name, in README.md' },
    repoPaths: [repo],
  })) as { order: { id: string; acceptance: unknown[] } }
  // A seeded draft has nothing to hand off: the state intake exists to move.
  expect(created.order.acceptance).toEqual([])
  // `converge` resolves once the scout session has started; it either ran or
  // said why, and silence would be the bug.
  const converged = await foundryChannel(handle, 'foundry:order.converge', {
    id: created.order.id,
  })
  expect(converged).not.toBeNull()
  return { id: created.order.id, branch: `foundry/${created.order.id.toLowerCase()}` }
}

/** The order's one project in the sidebar, named with its branch (ADR-061). */
function orderProject(order: ConvergedOrder) {
  return handle.page.locator('.branch-row__name').filter({ hasText: order.branch })
}

async function architectLaunchesReadOnly(order: ConvergedOrder): Promise<void> {
  await expect(orderProject(order)).toHaveCount(1, { timeout: 60_000 })
  const intakeProjects = handle.page.locator('.branch-row__name').filter({ hasText: 'intake' })
  await expect(intakeProjects).toHaveCount(0)
  await orderProject(order).click()
  await expectReadOnlyLaunch()
  // The architect reads the order's lane checkout, cut under the data root.
  const worktrees = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  expect(worktrees).toContain(join('.foundry', 'orders', order.id, 'worktrees'))
  expect(worktrees).toContain(`[${order.branch}]`)
}

async function deleteRemovesTheProject(order: ConvergedOrder): Promise<void> {
  const deleted = (await foundryChannel(handle, 'foundry:order.delete', { id: order.id })) as {
    removed?: string[]
  }
  expect(deleted.removed).toContain(`the project ${order.branch}`)
  await expect(orderProject(order)).toHaveCount(0, { timeout: 30_000 })
}

/** Opens the Forge from Quick Actions, and checks every surface renders and reads right. */
async function forgeOpensAndRenders(): Promise<void> {
  const step = test.step
  await step(
    'Foundry → New work order… opens the Forge with the cursor in the idea box',
    newWorkOrderFromQuickActions
  )
  await step('the extension is loaded and answering', extensionAnswers)
  await step(
    'the chrome says how much is waiting, from whichever surface you are on',
    chromeCountsWhatIsWaiting
  )
  await step('every surface is reachable by its accessible name and renders', everySurfaceRenders)
  await step('an idea becomes an order the Forge can show', ideaBecomesAnOrder)
  await step('an order fits the view it is shown in', orderFitsTheView)
  await step('controls that share a row in the Forge share one height', rowControlsShareOneHeight)
  await step(
    'no text on any Foundry surface renders at the browser default size',
    noTextAtTheDefaultSize
  )
  await step('nothing on any surface threw while rendering', nothingThrew)
}

/** The order is read, refused until complete, recorded, and the repository left alone. */
async function orderIsCheckedAndRecorded(): Promise<void> {
  const step = test.step
  await step('the repository is read before the operator is asked anything', repositoryReadFirst)
  await step('an incomplete order is refused, and says what is missing', incompleteOrderRefused)
  await step('a run cannot be started from an order nobody agreed', noRunWithoutAgreement)
  await step('the ledger records what happened, attributably', ledgerIsAttributable)
  await step(
    'the curator proposes nothing from a record with no repetition in it',
    curatorProposesNothing
  )
  await step('Foundry changes nothing in the repository it works on', repositoryUntouched)
}

test('an idea becomes an order that is refused until complete, and its architect launches read-only and goes when the order is deleted', async () => {
  test.setTimeout(240_000)
  await forgeOpensAndRenders()
  await orderIsCheckedAndRecorded()
  const order = await test.step('a seeded draft is handed to intake', convergeADraft)
  await test.step('intake launches the architect read-only in the order’s own project', () =>
    architectLaunchesReadOnly(order))
  await test.step('deleting the order removes its project', () => deleteRemovesTheProject(order))
})
