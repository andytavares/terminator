import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  inExtensionView,
  launchApp,
  openSettingsSection,
  projectGroup,
  quickActionsPanel,
  readTerminalRowsIn,
  runQuickActionFromPanel,
  acceptingDialog,
} from './helpers'
import { answerFolderPicker } from './main-stubs'

// The extension is tests/e2e/fixtures/extensions/probe, installed from its folder. The flow ends
// on its branch's terminal, where the right-edge audit runs (docs/ARCHITECTURE.md, "Renderer choice").

const PROBE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extensions', 'probe')
const CLASH = '"e2e.probe" wanted mnemonic "g" but it was taken by "terminator.git-integration"'

let handle: AppHandle

const extensionRow = (page: Page, name: string) =>
  page.locator('.extension-item').filter({
    has: page.locator('.extension-item__name', { hasText: name }),
  })
const probeRow = () => extensionRow(handle.page, 'E2E Probe')
const probeTab = () => handle.page.locator('.tab-bar--primary .tab-bar__tab', { hasText: 'Probe' })

async function relaunch(): Promise<void> {
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
}

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Ext', mkdtempSync(join(tmpdir(), 'terminator-e2e-ext-')))
  await addAndSelectProject(handle.page, 'Ext', 'probe-branch')
})

test.afterAll(async () => closeApp(handle))

async function bundledExtensionsListed(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Extensions')
  await expect(
    page.locator('.settings-panel__nav-item').filter({ hasText: 'Extensions' })
  ).toHaveClass(/settings-panel__nav-item--active/)
  // Bundled extensions (git-integration, notepad, task-vault, …) load at startup.
  const first = page.locator('.extension-item').first()
  await expect(first.locator('.extension-item__name')).toBeVisible()
  await expect(first.locator('.extension-item__actions')).toBeVisible()
  await closeSettingsPanel(page)
}

async function installListsItAcrossRestart(): Promise<void> {
  await answerFolderPicker(handle.app, PROBE)
  await openSettingsSection(handle.page, 'Extensions')
  await handle.page.getByRole('button', { name: 'Install from Directory' }).click()
  await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
  await relaunch()
  await openSettingsSection(handle.page, 'Extensions')
  await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
  await closeSettingsPanel(handle.page)
}

async function tabAndQuickActionsGroupShow(): Promise<void> {
  const { page, app } = handle
  await projectGroup(page, 'probe-branch').click()
  await expect(probeTab()).toBeVisible()
  await page.locator('.app-band__entry[aria-label="Quick actions (⌘P)"]').click()
  const group = quickActionsPanel(page)
    .locator('.qa-row')
    .filter({ has: page.locator('.qa-row__label', { hasText: /^Probe$/ }) })
  await expect(group.locator('.qa-key').first()).toHaveText('p')
  await page.keyboard.press('Escape')
  await runQuickActionFromPanel(page, 'Toggle log window')
  await expect(page.getByRole('region', { name: 'Application Logs' })).toContainText(CLASH)
  await page.locator('.log-window__btn--close').click()
  const logFile = join(await app.evaluate(({ app: a }) => a.getPath('logs')), 'terminator.log')
  await expect.poll(() => readFileSync(logFile, 'utf8')).toContain(CLASH)
}

async function commandBringsTabForward(): Promise<void> {
  await expect(probeTab()).not.toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(handle.page, 'Show the probe tab')
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
}

/** Polls a script in the probe's view, reading `fallback` while the view is away. */
const probeAnswers = (script: string, fallback: unknown) => () =>
  inExtensionView<unknown>(handle, 'e2e.probe', script).catch(() => fallback)

async function viewRunsCommandById(): Promise<void> {
  await expect(handle.page.locator('[data-extension-panel="e2e.probe"]')).toHaveCount(1)
  await expect
    .poll(probeAnswers(`typeof window.electronAPI?.extension?.runCommand === 'function'`, false))
    .toBe(true)
  // The view's frame exists only while its tab is on screen, so the command
  // runs from there and the leaving click comes after the call resolves.
  const ran = await inExtensionView<{ ok: boolean }>(
    handle,
    'e2e.probe',
    `window.electronAPI.extension.runCommand('e2e.probe.command.show-tab')`
  )
  expect(ran).toEqual({ ok: true })
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
}

async function reloadReactivatesAndTellsViews(): Promise<void> {
  const { page } = handle
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
  const marker = `before-reload-${Date.now()}`
  await inExtensionView(handle, 'e2e.probe', `window.__beforeReload = '${marker}'`)
  await openSettingsSection(page, 'Extensions')
  await probeRow().getByRole('button', { name: 'Reload' }).click()
  await expect(
    page.locator('.tmui-toast__message', { hasText: 'Extension reloaded' })
  ).toBeVisible()
  await closeSettingsPanel(page)
  // The open view is told to reload: its document is a new one, and its electronAPI
  // answers through the re-activated backend.
  await expect
    .poll(probeAnswers(`String(window.__beforeReload ?? 'reloaded')`, 'detached'))
    .toBe('reloaded')
  await expect
    .poll(
      probeAnswers(`window.electronAPI.extension.hasCommand('e2e.probe.command.show-tab')`, false)
    )
    .toBe(true)
}

/** Clicks a bundled extension's toggle and waits for the reload it causes, which comes only once
 * main has finished (seconds): `domcontentloaded` right after the click is answered by the old page. */
async function toggleAndReload(page: Page, extensionName: string): Promise<void> {
  const reloaded = page.waitForEvent('load')
  await extensionRow(page, extensionName)
    .getByRole('button', { name: /^(Disable|Enable)$/ })
    .click()
  await reloaded
  await expect(page.locator('.unified-sidebar')).toBeVisible()
}

async function expectNotepadStatus(page: Page, status: string): Promise<void> {
  await openSettingsSection(page, 'Extensions')
  await expect(extensionRow(page, 'Notepad').locator('.extension-item__status')).toHaveText(status)
}

async function bundledToggleTakesItAwayAndBack(): Promise<void> {
  const { page } = handle
  const notesButton = page.getByRole('button', { name: 'Notes', exact: true })
  await expect(notesButton).toBeVisible()
  await openSettingsSection(page, 'Extensions')
  await toggleAndReload(page, 'Notepad')
  await expect(notesButton).toHaveCount(0)
  await expectNotepadStatus(page, 'disabled')
  await toggleAndReload(page, 'Notepad')
  await expect(notesButton).toBeVisible()
  await expectNotepadStatus(page, 'enabled')
  await closeSettingsPanel(page)
}

async function uninstallRemovesItAcrossRestart(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Extensions')
  await acceptingDialog(page, () => probeRow().getByRole('button', { name: 'Uninstall' }).click())
  await expect(probeRow()).toHaveCount(0)
  await relaunch()
  await openSettingsSection(handle.page, 'Extensions')
  await expect(handle.page.locator('.extension-item').first()).toBeVisible()
  await expect(probeRow()).toHaveCount(0)
  await closeSettingsPanel(handle.page)
  await projectGroup(handle.page, 'probe-branch').click()
  await expect(probeTab()).toHaveCount(0)
}

// ── The terminal's right edge ─────────────────────────────────────────────────
// Positions alone cannot see a clipped glyph, hence the ink and overflow checks.

// xterm's default scrollbar width (ITerminalOptions.overviewRuler.width falls back to 14);
// FitAddon subtracts the same value from the columns it proposes.
const SCROLLBAR_WIDTH_PX = 14
// The single pane's terminal, the one the ruler is typed into before the split.
const PANE_SCREEN = '.terminal-pane__container .xterm-screen'

interface Geometry {
  scrollbarPx: number
  screenRight: number
  viewportContentRight: number
  renderedRight: number
}

// WebGL draws into canvases and has no `.xterm-rows`; the DOM renderer has rows and no canvas.
function scrollbarGeometry(selector: string): Promise<Geometry> {
  return handle.page.evaluate((sel) => {
    const scope = document.querySelector(sel) as HTMLElement
    const bar = scope.querySelector(
      '.xterm-scrollable-element > .scrollbar.vertical'
    ) as HTMLElement
    const sc = scope.querySelector('.xterm-screen') as HTMLElement
    const drawn = scope.querySelectorAll('.xterm-rows div, .xterm-screen canvas')
    let renderedRight = 0
    drawn.forEach((d) => {
      const b = (d as HTMLElement).getBoundingClientRect()
      if (b.width > 0 && b.right > renderedRight) renderedRight = b.right
    })
    return {
      scrollbarPx: bar.offsetWidth,
      screenRight: sc.getBoundingClientRect().right,
      viewportContentRight: bar.getBoundingClientRect().left,
      renderedRight,
    }
  }, selector)
}

/** The pane's scrollbar takes its exact layout width, and nothing drawn reaches under it. A
 * zero-width scrollbar means OS overlay scrollbars, which let glyphs render underneath. */
async function expectTextClearOfScrollbar(container: string): Promise<void> {
  await expect
    .poll(async () => (await scrollbarGeometry(container)).scrollbarPx)
    .toBe(SCROLLBAR_WIDTH_PX)
  const g = await scrollbarGeometry(container)
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.renderedRight).toBeLessThanOrEqual(g.viewportContentRight)
}

// The canvas's rightmost 4px, inside the last cell, must be blank before the ruler and inked
// after, or the last column was clipped or never drawn. A screenshot is the only read-back:
// WebGL clears its buffer after compositing.
const STRIP_WIDTH_PX = 4

/** Pixels in `png` that differ from its first: the ink drawn in the strip. */
function inkIn(base64: string): Promise<number> {
  return handle.page.evaluate(async (png) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let ink = 0
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) ink++
    }
    return ink
  }, base64)
}

async function lastColumnInk(): Promise<number> {
  const { page } = handle
  // The add-on's text canvas; its link layer is a second canvas of the same size.
  const canvas = page.locator(`${PANE_SCREEN} canvas:not(.xterm-link-layer)`)
  const box = (await canvas.boundingBox())!
  const right = box.x + box.width
  const png = await page.screenshot({
    clip: { x: right - STRIP_WIDTH_PX, y: box.y, width: STRIP_WIDTH_PX, height: box.height },
  })
  return inkIn(png.toString('base64'))
}

// Exactly `tput cols` '#'s, so the advance drift accumulates across the full width; awk is on
// every runner. No trailing newline, so the row holds nothing but the ruler.
const RULER_COMMAND =
  'clear; C=$(tput cols); awk -v c=$C \'BEGIN{s="";for(i=0;i<c;i++)s=s"#";printf "%s",s}\'\n'

/** WebGL draws to a canvas, so the ruler's last column is read as ink in the pixels. */
async function expectRulerInkInLastColumn(page: Page): Promise<void> {
  await page.keyboard.type('clear\n')
  await expect.poll(lastColumnInk).toBe(0)
  await page.keyboard.type(RULER_COMMAND)
  await expect
    .poll(lastColumnInk, {
      message: 'the last column of the full-width ruler line was not drawn',
    })
    .toBeGreaterThan(0)
}

/** The ruler row's columns, and its content width against its clip box. */
async function measureRulerRow(
  page: Page
): Promise<{ cols: number; scrollW: number; clientW: number }> {
  // Found by content, not at row 0: on CI the shell may print a notice first.
  const screen = page.locator(PANE_SCREEN)
  const rulerRow = async () =>
    (await readTerminalRowsIn(screen)).findIndex((row) => /^#+$/.test(row) && row.length >= 40)
  await expect.poll(rulerRow).toBeGreaterThanOrEqual(0)
  // The DOM renderer draws the screen's rows in order, one div each; its clip box is the
  // thing under test, so this measures the DOM on purpose.
  return screen.evaluate(
    (element, index) => {
      const el = element.querySelector('.xterm-rows')!.children[index] as HTMLElement
      const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd()
      return { cols: text.length, scrollW: el.scrollWidth, clientW: el.clientWidth }
    },
    await rulerRow()
  )
}

// Must run on a FULL-WIDTH single pane, hence before the split: the overhang is cols x
// per-column drift, so a half-width pane roughly halves it and can round away to nothing.
async function lastColumnGlyphNotClipped(): Promise<void> {
  const { page } = handle
  if ((await page.locator(`${PANE_SCREEN} canvas`).count()) > 0) {
    await expectRulerInkInLastColumn(page)
    return
  }
  await page.keyboard.type(RULER_COMMAND)
  const m = await measureRulerRow(page)
  // Guard the guard: too few columns and the accumulated overhang rounds to zero.
  expect(m.cols, 'ruler row too narrow for the overhang to be measurable').toBeGreaterThanOrEqual(
    80
  )
  expect(
    m.scrollW,
    `row content (${m.scrollW}px) overflows its clip box (${m.clientW}px) — the last column's glyph is being sliced`
  ).toBeLessThanOrEqual(m.clientW)
}

async function splitPaneTextClearOfScrollbar(): Promise<void> {
  await handle.page.keyboard.press('Meta+d')
  await expect(handle.page.locator('.leaf-pane').first()).toBeVisible()
  await expectTextClearOfScrollbar('.leaf-pane__container')
}

async function paddingIsTheTerminalsColour(): Promise<void> {
  const colours = await handle.page.evaluate(() => {
    const xterm = document.querySelector('.xterm')!
    return {
      surround: getComputedStyle(xterm.parentElement!).backgroundColor,
      padding: getComputedStyle(xterm.querySelector('.xterm-viewport')!).backgroundColor,
    }
  })
  // XTERM_THEMES.dark.background behind a clear viewport: the padding shows the cells' colour.
  expect(colours).toEqual({ surround: 'rgb(30, 30, 30)', padding: 'rgba(0, 0, 0, 0)' })
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const RIGHT_EDGE_STEPS: Steps = [
  [
    'single pane: the scrollbar has its real width and no text runs under it',
    () => expectTextClearOfScrollbar('.terminal-pane__container'),
  ],
  ['the last-column glyph is not clipped', lastColumnGlyphNotClipped],
  ['split pane: no text runs under the scrollbar', splitPaneTextClearOfScrollbar],
  [
    "the padding around the terminal is the terminal's own colour, so no edge shows",
    paddingIsTheTerminalsColour,
  ],
]

async function terminalRightEdgeIsClean(): Promise<void> {
  await expect(handle.page.locator('.terminal-pane').first()).toBeVisible()
  for (const [title, body] of RIGHT_EDGE_STEPS) await test.step(title, body)
}

const LIFECYCLE_STEPS: Steps = [
  [
    'the Extensions section is active and lists the bundled extensions, each with a name and actions',
    bundledExtensionsListed,
  ],
  [
    'Install from Directory lists it as enabled, and it is still there after a restart',
    installListsItAcrossRestart,
  ],
  [
    'its project tab shows, and its Quick Actions group gets a free key, logged',
    tabAndQuickActionsGroupShow,
  ],
  ['its command brings its project tab forward', commandBringsTabForward],
  ['its view can run a command by id, as one extension runs another', viewRunsCommandById],
  ['Reload re-activates it and tells its open views', reloadReactivatesAndTellsViews],
  [
    'a bundled extension switched off goes away, and switched on comes back',
    bundledToggleTakesItAwayAndBack,
  ],
  ['Uninstall removes it, and it stays gone after a restart', uninstallRemovesItAcrossRestart],
  ["the branch's terminal draws up to its right edge and no further", terminalRightEdgeIsClean],
]

test('an extension is installed from a folder, used, reloaded and removed, across restarts', async () => {
  for (const [title, body] of LIFECYCLE_STEPS) await test.step(title, body)
})
