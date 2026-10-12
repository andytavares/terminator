import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Regression guard for right-edge text clipping.
//
// THE ACTUAL BUG: xterm's DOM renderer gives each row div `overflow: hidden` and a width
// of exactly cols x cellWidth, but lays text out using the font's natural advance width.
// The per-column difference accumulates across the line, so the final glyph's ink
// overhangs the row box and gets sliced. The fix widens the row's clip box (TerminalPane
// .css). `last-column glyph is not clipped` below is the test that actually catches it.
//
// IMPORTANT: not every geometry assertion can see this. An earlier revision of this file
// asserted inter-element POSITIONS (screenRight <= viewportContentRight etc.) and passed
// cleanly the entire time the bug was live — comparing where boxes sit relative to each
// other says nothing about whether a box's own content overflows it. The guard below
// instead compares a row's content extent (scrollWidth) against its clip box
// (clientWidth), which is the overflow being clipped.
//
// Under xterm 5 the fix was a CSS rule widening each row's clip box by 6px. xterm 6 places
// its own scrollbar directly beside the screen, so that widening put rows under the
// scrollbar; with the rule removed this guard passes on xterm 6. Any change to that test
// must be re-validated against a build (the suite runs against out/, so skipping the
// rebuild silently tests the old bundle).
//
// The scrollbar-width tests below guard a separate, real property: that terminal geometry
// does not depend on the user's macOS overlay-scrollbar setting. They were mistakenly
// believed to fix the clipping bug. They do not, and never did.
//
// xterm 6 draws its own scrollbar (`.xterm-scrollable-element > .scrollbar.vertical`) with a
// fixed width, and FitAddon reserves exactly that width, so the OS setting no longer matters.

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
  maxRowRight: number
}

async function measure(selector: string): Promise<Geometry> {
  return handle.page.evaluate((sel) => {
    const scope = document.querySelector(sel) as HTMLElement
    const bar = scope.querySelector(
      '.xterm-scrollable-element > .scrollbar.vertical'
    ) as HTMLElement
    const sc = scope.querySelector('.xterm-screen') as HTMLElement
    const rows = scope.querySelector('.xterm-rows') as HTMLElement
    const scrollbarPx = bar.offsetWidth
    let maxRowRight = 0
    rows.querySelectorAll('div').forEach((d) => {
      const b = (d as HTMLElement).getBoundingClientRect()
      if (b.right > maxRowRight) maxRowRight = b.right
    })
    return {
      scrollbarPx,
      screenRight: sc.getBoundingClientRect().right,
      viewportContentRight: bar.getBoundingClientRect().left,
      maxRowRight,
    }
  }, selector)
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
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})

// The real guard for the clipping bug.
//
// The row div's content (the sum of the font's natural per-character advances) is wider
// than the row's own clip box (cols x xterm's rounded cellWidth). scrollWidth reports the
// content width, clientWidth the clip box — so content overflowing its clip box is exactly
// the condition that slices the last glyph, and it is what this asserts.
//
// This is NOT the same class of check as the three tests above. Those compare element
// POSITIONS against each other and cannot see inside a box; they passed for the entire
// time the bug was live. This compares a box's content extent against the box itself.
// Under xterm 5 a full-width row measured scrollWidth 986 vs clientWidth 984 without the
// old CSS widening, and this failed. Re-run it against a fresh build before ever relaxing
// this test.
//
// Must run on a FULL-WIDTH single pane, hence its position before the split test below:
// the overhang is cols x per-column drift, so a half-width pane roughly halves it and
// can round away to nothing.
test('last-column glyph is not clipped', async () => {
  const { page } = handle
  test.setTimeout(120000)

  // A line of exactly `tput cols` identical characters, so the per-column advance drift
  // accumulates across the full width. awk rather than python3: it is guaranteed present
  // on both macOS and Linux runners. No trailing newline, so the prompt wraps to the next
  // row and this row stays nothing but the ruler.
  await page.keyboard.type(
    'clear; C=$(tput cols); awk -v c=$C \'BEGIN{s="";for(i=0;i<c;i++)s=s"#";printf "%s",s}\'\n'
  )

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
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})
