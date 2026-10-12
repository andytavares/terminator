import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Regression guard for right-edge text clipping.
//
// THE BUG: xterm's DOM renderer gives each row div `overflow: hidden` and a width of
// exactly cols x cellWidth, but lays text out with the font's natural advance width. The
// difference accumulates across the line, so the final glyph overhangs the row box and is
// sliced (on macOS with xterm 6: 902px of content in a 900px row). A CSS rule that widens
// the rows cannot come back: xterm 6 draws its own scrollbar beside the screen, so wider
// rows sit under it.
//
// THE FIX: a visible terminal renders with the WebGL add-on (TerminalInstance.mount), which
// has no DOM rows to clip; glyphs are drawn into cells of a canvas that is cols x cellWidth
// wide. The DOM renderer remains for terminals past the WebGL context limit, tiles, and
// machines without WebGL2. These tests ask which renderer is live and guard each:
//   - WebGL: the canvas ends at or before the scrollbar, and the last column holds ink.
//   - DOM: a row's content (scrollWidth) fits its clip box (clientWidth).
// Positions alone cannot see a clipped glyph, which is why the ink and overflow checks exist.
//
// The scrollbar-width tests guard a separate property: that terminal geometry does not
// depend on the user's macOS overlay-scrollbar setting. xterm 6 draws its own scrollbar
// (`.xterm-scrollable-element > .scrollbar.vertical`) with a fixed width, and FitAddon
// reserves exactly that width.
//
// The suite runs against out/: rebuild before running it.

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

async function usesWebgl(): Promise<boolean> {
  return handle.page.evaluate(() => !document.querySelector('.xterm-rows'))
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

// The WebGL canvas covers exactly cols x cellWidth, so the last column is drawn only if it
// holds ink inside the canvas. This reads what is on screen: a screenshot of the canvas's
// rightmost 4px (inside the last cell, whose '#' ink spans nearly its whole width). It must
// be blank before the ruler line is printed and inked after, which cannot pass if the last
// column is clipped or never drawn. The canvas keeps no readable buffer (WebGL clears it
// after compositing), so a screenshot is the only faithful read-back.
const STRIP_WIDTH_PX = 4

async function lastColumnInk(): Promise<number> {
  const { page } = handle
  const box = await page.evaluate(() => {
    const canvas = document.querySelector('.xterm-screen canvas') as HTMLCanvasElement
    const b = canvas.getBoundingClientRect()
    return { right: b.right, top: b.top, height: b.height }
  })
  const png = await page.screenshot({
    clip: {
      x: box.right - STRIP_WIDTH_PX,
      y: box.top,
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

// A line of exactly `tput cols` identical characters, so the per-column advance drift
// accumulates across the full width. awk rather than python3: it is guaranteed present
// on both macOS and Linux runners. No trailing newline, so the prompt wraps to the next
// row and this row stays nothing but the ruler.
const RULER_COMMAND =
  'clear; C=$(tput cols); awk -v c=$C \'BEGIN{s="";for(i=0;i<c;i++)s=s"#";printf "%s",s}\'\n'

// Must run on a FULL-WIDTH single pane, hence its position before the split test below:
// the overhang is cols x per-column drift, so a half-width pane roughly halves it and
// can round away to nothing.
test('last-column glyph is not clipped', async () => {
  const { page } = handle
  test.setTimeout(120000)

  if (await usesWebgl()) {
    await page.keyboard.type('clear\n')
    await expect.poll(lastColumnInk, { timeout: 15000 }).toBe(0)
    await page.keyboard.type(RULER_COMMAND)
    await expect
      .poll(lastColumnInk, {
        message: 'the last column of the full-width ruler line was not drawn',
        timeout: 30000,
      })
      .toBeGreaterThan(0)
    return
  }

  await page.keyboard.type(RULER_COMMAND)
  // Poll for the ruler row by content rather than waiting a fixed interval and assuming
  // row 0 — on CI the shell prints a "default interactive shell is now zsh" notice first,
  // so the ruler does not reliably land on any particular row.
  const row = await page.waitForFunction(
    () => {
      const rows =
        document.querySelector('.xterm-rows.xterm-focus') ?? document.querySelector('.xterm-rows')
      if (!rows) return null
      for (const el of Array.from(rows.children) as HTMLElement[]) {
        const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd()
        // Strictly the ruler: nothing but '#', and long enough to be a real full-width line.
        if (/^#+$/.test(text) && text.length >= 40) {
          return { cols: text.length, scrollW: el.scrollWidth, clientW: el.clientWidth }
        }
      }
      return null
    },
    undefined,
    { timeout: 30000 }
  )
  const m = (await row.jsonValue()) as { cols: number; scrollW: number; clientW: number }

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
