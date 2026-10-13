import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  terminalRowsIn,
} from './helpers'

// Regression guard for right-edge text clipping, per renderer, and for geometry that ignores
// macOS overlay scrollbars: docs/ARCHITECTURE.md, "Renderer choice". Positions alone cannot
// see a clipped glyph, hence the ink and overflow checks. Runs against out/: rebuild first.

// xterm's default scrollbar width (ITerminalOptions.overviewRuler.width falls back to 14);
// FitAddon subtracts the same value from the columns it proposes.
const SCROLLBAR_WIDTH_PX = 14

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  // Set up here rather than in the first test so no test depends on another's side
  // effects — otherwise a failure in one cascades into null-selector errors in the rest.
  const { page, userDataDir } = handle
  await createWorkspace(page, 'WS-Edge', userDataDir)
  await addAndSelectProject(page, 'WS-Edge', 'Proj-Edge')
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await page.waitForSelector('.xterm-screen', { timeout: 15000 })
  // Wait for xterm's own layout to settle at its pinned scrollbar width rather
  // than a fixed delay — the geometry assertions below depend on it.
  await expect
    .poll(async () => (await measure('.terminal-pane__container')).scrollbarPx, { timeout: 15000 })
    .toBe(SCROLLBAR_WIDTH_PX)
})

test.afterAll(async () => {
  await closeApp(handle)
})

interface Geometry {
  scrollbarPx: number
  screenRight: number
  viewportContentRight: number
  renderedRight: number
}

// WebGL draws into canvases and has no `.xterm-rows`; the DOM renderer has rows and no canvas.
async function measure(selector: string): Promise<Geometry> {
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

// The single pane's terminal, the one these tests type into until the split test.
const PANE_SCREEN = '.terminal-pane__container .xterm-screen'

// The WebGL add-on draws into canvases inside the screen; xterm 6's DOM renderer has none.
async function usesWebgl(): Promise<boolean> {
  return (await handle.page.locator(`${PANE_SCREEN} canvas`).count()) > 0
}

test('the terminal reserves real layout width for its scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  // A zero-width scrollbar means we are back on OS overlay scrollbars, which is exactly
  // the condition that lets glyphs render underneath the scrollbar.
  // Exact, not just non-zero: xterm's own scrollbar has a fixed width that FitAddon
  // reserves. Any other value means geometry and the reserved width have drifted apart.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
})

test('single-pane: rendered text never extends under the scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.renderedRight).toBeLessThanOrEqual(g.viewportContentRight)
})

// The canvas's rightmost 4px, inside the last cell, must be blank before the ruler and inked
// after, or the last column was clipped or never drawn. A screenshot is the only read-back:
// WebGL clears its buffer after compositing.
const STRIP_WIDTH_PX = 4

async function lastColumnInk(): Promise<number> {
  const { page } = handle
  // The add-on's text canvas; its link layer is a second canvas of the same size.
  const canvas = page.locator(`${PANE_SCREEN} canvas:not(.xterm-link-layer)`)
  const box = (await canvas.boundingBox())!
  const right = box.x + box.width
  const png = await page.screenshot({
    clip: {
      x: right - STRIP_WIDTH_PX,
      y: box.y,
      width: STRIP_WIDTH_PX,
      height: box.height,
    },
  })
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
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
  }, png.toString('base64'))
}

// Exactly `tput cols` '#'s, so the advance drift accumulates across the full width; awk is on
// every runner. No trailing newline, so the row holds nothing but the ruler.
const RULER_COMMAND =
  'clear; C=$(tput cols); awk -v c=$C \'BEGIN{s="";for(i=0;i<c;i++)s=s"#";printf "%s",s}\'\n'

/** WebGL draws to a canvas, so the ruler's last column is read as ink in the pixels. */
async function expectRulerInkInLastColumn(page: Page): Promise<void> {
  await page.keyboard.type('clear\n')
  await expect.poll(lastColumnInk, { timeout: 15000 }).toBe(0)
  await page.keyboard.type(RULER_COMMAND)
  await expect
    .poll(lastColumnInk, {
      message: 'the last column of the full-width ruler line was not drawn',
      timeout: 30000,
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
    (await terminalRowsIn(screen)).findIndex((row) => /^#+$/.test(row) && row.length >= 40)
  await expect.poll(rulerRow, { timeout: 30000 }).toBeGreaterThanOrEqual(0)
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

// Must run on a FULL-WIDTH single pane, hence its position before the split test below:
// the overhang is cols x per-column drift, so a half-width pane roughly halves it and
// can round away to nothing.
test('last-column glyph is not clipped', async () => {
  const { page } = handle
  test.setTimeout(120000)

  if (await usesWebgl()) {
    await expectRulerInkInLastColumn(page)
    return
  }

  await page.keyboard.type(RULER_COMMAND)
  const m = await measureRulerRow(page)

  // Guard the guard: too few columns and the accumulated overhang rounds to zero, which
  // would make the assertion below vacuously true.
  expect(m.cols, 'ruler row too narrow for the overhang to be measurable').toBeGreaterThanOrEqual(
    80
  )
  expect(
    m.scrollW,
    `row content (${m.scrollW}px) overflows its clip box (${m.clientW}px) — the last column's glyph is being sliced`
  ).toBeLessThanOrEqual(m.clientW)
})

test('split-pane: rendered text never extends under the scrollbar', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+d')
  await page.waitForSelector('.leaf-pane', { timeout: 15000 })
  // Wait for the new pane's own layout to settle at its pinned scrollbar
  // width rather than a fixed delay.
  await expect
    .poll(async () => (await measure('.leaf-pane__container')).scrollbarPx, { timeout: 15000 })
    .toBe(SCROLLBAR_WIDTH_PX)

  const g = await measure('.leaf-pane__container')
  // Exact, not just non-zero: xterm's own scrollbar has a fixed width that FitAddon
  // reserves. Any other value means geometry and the reserved width have drifted apart.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.renderedRight).toBeLessThanOrEqual(g.viewportContentRight)
})
