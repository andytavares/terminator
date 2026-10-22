import type { Frame, Page } from '@playwright/test'

// Each function below runs in the page, so each uses only the DOM and the functions sent with it.

/** Two controls that sit side by side and do not line up. */
interface Misalignment {
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

/** Resolves once the page has drawn the frame its last change asked for. */
function afterDrawnFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

/** The misaligned control pairs, and any radio or checkbox drawn wrong, on `page` (or an extension frame), read after a drawn frame so a
 * layout still being applied is not measured, labelled with `screen`. */
export async function misalignedOn(
  page: Pick<Page, 'evaluate'> | Pick<Frame, 'evaluate'>,
  screen: string
): Promise<string[]> {
  const helpers = [visibleOnScreen, boxed, described, besideEachOther, mismatch, misalignedControls]
  const script = `(async () => { ${[afterDrawnFrame, ...helpers].map(String).join('\n')}
    await afterDrawnFrame()
    return misalignedControls(${JSON.stringify(CONTROLS)}) })()`
  const found = (await page.evaluate(script)) as Misalignment[]
  const misaligned = found.map(
    (m) =>
      `${screen}: ${m.first} (${m.heights[0]}px) beside ${m.second} (${m.heights[1]}px), ` +
      `centres ${m.centres[0].toFixed(1)} / ${m.centres[1].toFixed(1)}`
  )
  return [...misaligned, ...(await wronglyDrawnTogglesOn(page, screen))]
}

/** A radio or checkbox that is not drawn at the design system's size and corner. */
interface DrawnWrong {
  control: string
  size: [number, number]
  radius: string
}

function wronglyDrawnToggles(): DrawnWrong[] {
  const drawn = { radio: '50%', checkbox: '3px' }
  const toggles = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
  return toggles
    .filter((el) => visibleOnScreen(el) && !el.closest('.xterm, .cm-editor, .tmui-tooltip'))
    .flatMap((el) => {
      const box = el.getBoundingClientRect()
      const radius = getComputedStyle(el).borderTopLeftRadius
      const kind = (el as HTMLInputElement).type as keyof typeof drawn
      const right = box.width === 14 && box.height === 14 && radius === drawn[kind]
      return right ? [] : [{ control: described(el), size: [box.width, box.height], radius }]
    })
}

/** The radios and checkboxes on `page` not drawn as 14px circles and 14px rounded squares: a
 * stylesheet written for text fields can stretch them into pills, which looks like a switch. */
async function wronglyDrawnTogglesOn(
  page: Pick<Page, 'evaluate'> | Pick<Frame, 'evaluate'>,
  screen: string
): Promise<string[]> {
  const helpers = [visibleOnScreen, described, wronglyDrawnToggles]
  const script = `(async () => { ${[afterDrawnFrame, ...helpers].map(String).join('\n')}
    await afterDrawnFrame()
    return wronglyDrawnToggles() })()`
  const found = (await page.evaluate(script)) as DrawnWrong[]
  return found.map(
    (t) => `${screen}: ${t.control} is ${t.size[0]}x${t.size[1]}, radius ${t.radius}`
  )
}
