import type { Page } from '@playwright/test'

// Each function below runs in the page, so each uses only the DOM and the functions sent with it.

/** Two controls that sit side by side and do not line up. */
export interface Misalignment {
  first: string
  second: string
  heights: [number, number]
  centres: [number, number]
}

const CONTROLS =
  'button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"])' +
  ':not([type="range"]):not([type="hidden"]):not([type="file"]):not([type="color"])'

function visibleOnScreen(el: Element): boolean {
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
}

/** Whether the control draws a box: a link-styled button does not, so only its centre counts. */
function boxed(el: Element): boolean {
  const style = getComputedStyle(el)
  const painted = !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)
  return painted || parseFloat(style.borderTopWidth) > 0
}

function described(el: Element): string {
  const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent
  const classes = [...el.classList].join('.')
  return `${el.tagName.toLowerCase()}.${classes} "${(label ?? '').trim().slice(0, 30)}"`
}

/** Two controls under one parent, on one line (vertical ranges overlap) and under 24px apart. */
function besideEachOther(a: Element, b: Element): boolean {
  if (a.parentElement !== b.parentElement || a.contains(b) || b.contains(a)) return false
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  const overlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
  return overlap > 0 && Math.max(rb.left - ra.right, ra.left - rb.right) <= 24
}

/** The pair's mismatch, or null when they line up within a pixel. */
function mismatch(a: Element, b: Element): Misalignment | null {
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  const heights: [number, number] = [ra.height, rb.height]
  const centres: [number, number] = [ra.top + ra.height / 2, rb.top + rb.height / 2]
  const sized = boxed(a) && boxed(b) && Math.abs(heights[0] - heights[1]) > 1
  if (!sized && Math.abs(centres[0] - centres[1]) <= 1) return null
  return { first: described(a), second: described(b), heights, centres }
}

function misalignedControls(selector: string): Misalignment[] {
  const controls = [...document.querySelectorAll(selector)].filter(
    (el) => visibleOnScreen(el) && !el.closest('.xterm, .cm-editor, .tmui-tooltip')
  )
  return controls.flatMap((a, i) =>
    controls
      .slice(i + 1)
      .filter((b) => besideEachOther(a, b))
      .map((b) => mismatch(a, b))
      .filter((found): found is Misalignment => found !== null)
  )
}

/** The misaligned control pairs on `page` now, each labelled with `screen`. */
export async function misalignedOn(page: Page, screen: string): Promise<string[]> {
  const helpers = [visibleOnScreen, boxed, described, besideEachOther, mismatch, misalignedControls]
  const script = `(() => { ${helpers.map(String).join('\n')}
    return misalignedControls(${JSON.stringify(CONTROLS)}) })()`
  const found = (await page.evaluate(script)) as Misalignment[]
  return found.map(
    (m) =>
      `${screen}: ${m.first} (${m.heights[0]}px) beside ${m.second} (${m.heights[1]}px), ` +
      `centres ${m.centres[0].toFixed(1)} / ${m.centres[1].toFixed(1)}`
  )
}
