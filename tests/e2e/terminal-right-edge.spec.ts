import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Regression guard for right-edge text clipping.
//
// THE ACTUAL BUG: xterm's DOM renderer gives each row div `overflow: hidden` and a width
// of exactly cols x cellWidth, but lays text out using the font's natural advance width.
// The per-column difference accumulates across the line, so the final glyph's ink
// overhangs the row box and gets sliced. The fix widens the row's clip box (TerminalPane
// .css). `last-column glyph is not clipped` below is the test that actually catches it.
//
// IMPORTANT: this is only detectable by measuring RENDERED INK. An earlier revision of
// this file asserted layout-box invariants (screenRight <= viewportContentRight etc.) and
// passed cleanly the entire time the bug was live — element bounding rects say nothing
// about whether a glyph's ink was clipped inside its box. Do not "simplify" the
// screenshot-based test back into a bounding-rect check; it would guard nothing.
//
// The scrollbar-width tests below guard a separate, real property: that terminal geometry
// does not depend on the user's macOS overlay-scrollbar setting. They were mistakenly
// believed to fix the clipping bug. They do not, and never did.

// Must match the ::-webkit-scrollbar width in TerminalPane.css.
const SCROLLBAR_WIDTH_PX = 10

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
  await page.waitForTimeout(1500)
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
    const vp = scope.querySelector('.xterm-viewport') as HTMLElement
    const sc = scope.querySelector('.xterm-screen') as HTMLElement
    const rows = scope.querySelector('.xterm-rows') as HTMLElement
    const scrollbarPx = vp.offsetWidth - vp.clientWidth
    let maxRowRight = 0
    rows.querySelectorAll('div').forEach((d) => {
      const b = (d as HTMLElement).getBoundingClientRect()
      if (b.right > maxRowRight) maxRowRight = b.right
    })
    return {
      scrollbarPx,
      screenRight: sc.getBoundingClientRect().right,
      viewportContentRight: vp.getBoundingClientRect().right - scrollbarPx,
      maxRowRight,
    }
  }, selector)
}

test('the terminal viewport reserves real layout width for its scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  // A zero-width scrollbar means we are back on OS overlay scrollbars, which is exactly
  // the condition that lets glyphs render underneath the scrollbar.
  // Exact, not just non-zero: the width is pinned by our ::-webkit-scrollbar rule. Any
  // other value means the scroller fell back to the OS scrollbar (0 with macOS overlay
  // scrollbars, ~4-15 with classic ones) and the geometry is environment-dependent again.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
})

test('single-pane: rendered text never extends under the scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})

test('split-pane: rendered text never extends under the scrollbar', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+d')
  await page.waitForSelector('.leaf-pane', { timeout: 15000 })
  await page.waitForTimeout(1500)

  const g = await measure('.leaf-pane__container')
  // Exact, not just non-zero: the width is pinned by our ::-webkit-scrollbar rule. Any
  // other value means the scroller fell back to the OS scrollbar (0 with macOS overlay
  // scrollbars, ~4-15 with classic ones) and the geometry is environment-dependent again.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})

// The real guard. Renders "X" in every other column of a full-width line, then measures
// each glyph's ink width from a screenshot. Every X is the same character in the same
// font, so they must all rasterize to the same ink width — if the last one is narrower,
// its right side is being clipped at the row boundary.
test('last-column glyph is not clipped', async () => {
  const { page } = handle
  test.setTimeout(120000)

  await page.keyboard.type(
    'clear; C=$(tput cols); python3 -c "import sys;c=int(sys.argv[1]);sys.stdout.write((\'.X\'*(c//2))[:c])" $C\n'
  )
  await page.waitForTimeout(2500)

  const row = await page.evaluate(() => {
    const r = (document.querySelector('.xterm-rows') as HTMLElement).children[0] as HTMLElement
    const b = r.getBoundingClientRect()
    return { top: b.top, height: b.height }
  })

  const shotPath = test.info().outputPath('last-column.png')
  await page.screenshot({ path: shotPath })

  // Measure ink runs along the first text row straight out of the PNG.
  const widths: number[] = await page.evaluate(
    async ({ dataUrl, top, height }) => {
      const img = new Image()
      await new Promise((res) => {
        img.onload = res
        img.src = dataUrl
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const scale = img.width / window.innerWidth
      const y0 = Math.floor(top * scale)
      const y1 = Math.ceil((top + height) * scale)
      const data = ctx.getImageData(0, y0, img.width, y1 - y0).data
      const lit: boolean[] = []
      for (let x = 0; x < img.width; x++) {
        let on = false
        for (let y = 0; y < y1 - y0; y++) {
          const i = (y * img.width + x) * 4
          if (Math.max(data[i], data[i + 1], data[i + 2]) > 90) {
            on = true
            break
          }
        }
        lit.push(on)
      }
      const runs: number[] = []
      let start = -1
      for (let x = 0; x < lit.length; x++) {
        if (lit[x] && start < 0) start = x
        else if (!lit[x] && start >= 0) {
          runs.push(x - start)
          start = -1
        }
      }
      if (start >= 0) runs.push(lit.length - start)
      // Wide runs are the X glyphs; the narrow ones are the "." separators.
      return runs.filter((w) => w >= 8)
    },
    {
      dataUrl: `data:image/png;base64,${(await readFile(shotPath)).toString('base64')}`,
      top: row.top,
      height: row.height,
    }
  )

  expect(widths.length).toBeGreaterThan(20)
  // The modal ink width is what an unclipped X measures.
  const counts = new Map<number, number>()
  widths.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1))
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const last = widths[widths.length - 1]
  // Before the fix: modal 15, last 12.
  expect(last).toBe(modal)
})
