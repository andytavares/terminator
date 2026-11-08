import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  launchApp,
  readTerminalRowsIn,
} from './helpers'
import { expectTerminalFocused } from './session-views'

// A branch's terminal draws up to its right edge and no further (docs/ARCHITECTURE.md, "Renderer
// choice"). Layout and glyph ink exist only in a real window, so this stays end to end.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Edge', mkdtempSync(join(tmpdir(), 'terminator-e2e-edge-')))
  await addAndSelectProject(handle.page, 'Edge', 'edge-branch')
  await expect(handle.page.locator('.terminal-pane').first()).toBeVisible()
})

test.afterAll(async () => closeApp(handle))

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
  await page.locator(PANE_SCREEN).click()
  await expectTerminalFocused(page)
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
  expect(colours).toEqual({ surround: 'rgb(25, 25, 29)', padding: 'rgba(0, 0, 0, 0)' })
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

test("a branch's terminal draws up to its right edge and no further", async () => {
  for (const [title, body] of RIGHT_EDGE_STEPS) await test.step(title, body)
})
