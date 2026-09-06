import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * Do extension surfaces read in both themes?
 *
 * This cannot be answered by reading the stylesheets. Half the colours in them
 * are `rgba()` over an inherited surface or a `color-mix()`, and the value a
 * reader actually sees is the composite — which only a browser computes. So
 * this walks the real rendered DOM of each extension view and measures what is
 * on screen.
 *
 * It also exists because of what building it found: `EXTENSION_BASE_CSS` had
 * one `:root` block, dark, and no `[data-theme='light']` at all — while the
 * core app has had a working, AA-verified light theme since TAV-8. Nothing in
 * main, the preload or any extension mentioned the theme. Switching the app to
 * light left every extension panel dark. The first test here is the wiring;
 * the rest is the contrast it made measurable.
 */

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await handle.page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** Run a script inside the first loaded extension view whose URL matches. */
function inView<T>(urlPart: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { part, src }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes(part))
      if (!view) throw new Error(`no loaded view matching ${part}`)
      return view.executeJavaScript(src) as Promise<unknown>
    },
    { part: urlPart, src: script }
  ) as Promise<T>
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  // Driven through the same API the settings panel uses, as a script string —
  // `window.electronAPI` is injected by the preload and has no type here.
  await handle.page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    window.electronAPI.extension.setTheme('${theme}')
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await handle.page.waitForTimeout(400)
}

/**
 * Bring one extension's surface up.
 *
 * The check is per-extension, not "is any panel open" — with the looser check
 * the first extension opened stayed up and every later surface was measured
 * against the wrong document.
 */
async function openExtension(id: string, urlPart: string): Promise<void> {
  const panel = `[data-extension-panel="${id}"]`
  const showing = async () =>
    handle.page
      .locator(panel)
      .count()
      .then((n) => n > 0)
  if (!(await showing())) {
    const button = handle.page.locator(`button[aria-label="${LABELS[id]}"]`)
    await expect(button).toBeVisible({ timeout: 15000 })
    await button.click()
  }
  await expect.poll(showing, { timeout: 20000 }).toBe(true)
  await handle.page.waitForTimeout(800)
  await inView(urlPart, '1')
}

/**
 * Every visible text node in the view, with its colour and the colour actually
 * behind it.
 *
 * Walking up for the first non-transparent ancestor background is the whole
 * point: an element with `background: rgba(255,255,255,0.06)` composites over
 * whatever is under it, and reading its own `background-color` would report a
 * near-transparent white that nothing renders.
 */
const CONTRAST_PROBE = `(() => {
  function parse(c) {
    const m = c.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  function over(fg, bg) {
    const a = fg.a
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    }
  }
  function lum({ r, g, b }) {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  function ratio(a, b) {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  // The composited background behind an element: every translucent layer from
  // the element up, painted onto the first opaque one.
  function backdrop(el) {
    const stack = []
    let node = el
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0) {
        stack.push(bg)
        if (bg.a === 1) break
      }
      node = node.parentElement
    }
    let base = stack.length && stack[stack.length - 1].a === 1
      ? stack.pop()
      : { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }

  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const text = n.textContent.trim()
    if (!text) continue
    const el = n.parentElement
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    if (parseFloat(cs.opacity) < 0.15) continue
    // WCAG 1.4.3 exempts inactive controls, and a disabled control is
    // supposed to look unavailable.
    if (el.closest('[disabled],[aria-disabled="true"]')) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const bg = backdrop(el)
    const composited = over({ ...fg, a: fg.a * parseFloat(cs.opacity) }, bg)
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    // WCAG large text: 18.66px bold, or 24px.
    const large = size >= 24 || (bold && size >= 18.66)
    out.push({
      text: text.slice(0, 40),
      selector: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
      ratio: Math.round(ratio(composited, bg) * 100) / 100,
      required: large ? 3 : 4.5,
    })
  }
  return out
})()`

interface Probe {
  text: string
  selector: string
  ratio: number
  required: number
}

const LABELS: Record<string, string> = {
  'terminator.speckit-pilot': 'SpecKit',
  'terminator.task-vault': 'Task Vault',
  'terminator.notepad': 'Notes',
  'terminator.remote-control': 'Remote Control',
}

const SURFACES: { id: string; label: string; urlPart: string }[] = [
  { id: 'terminator.speckit-pilot', label: 'SpecKit', urlPart: 'speckit' },
  { id: 'terminator.task-vault', label: 'Task Vault', urlPart: 'task-vault' },
  { id: 'terminator.notepad', label: 'Notepad', urlPart: 'notepad' },
  { id: 'terminator.remote-control', label: 'Remote Control', urlPart: 'remote-control' },
]

test('an extension view follows the app into the light theme', async () => {
  await openExtension('terminator.speckit-pilot', 'speckit')

  await setTheme('light')
  const light = await inView<string | null>(
    'speckit',
    "document.documentElement.getAttribute('data-theme')"
  )
  expect(light).toBe('light')

  // The attribute is only useful if it actually repaints. Dark's base is
  // #0c0c0f and light's is #f0f0f5, so the body's own ground has to change.
  const lightBg = await inView<string>('speckit', 'getComputedStyle(document.body).backgroundColor')

  await setTheme('dark')
  const dark = await inView<string | null>(
    'speckit',
    "document.documentElement.getAttribute('data-theme')"
  )
  expect(dark).not.toBe('light')
  const darkBg = await inView<string>('speckit', 'getComputedStyle(document.body).backgroundColor')

  expect(lightBg).not.toBe(darkBg)
})

for (const { id, label, urlPart } of SURFACES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${label} text meets WCAG AA in the ${theme} theme`, async () => {
      await openExtension(id, urlPart)
      await setTheme(theme)
      await handle.page.waitForTimeout(300)

      const probes = await inView<Probe[]>(urlPart, CONTRAST_PROBE)
      expect(probes.length, `${label} rendered no text to measure`).toBeGreaterThan(0)

      const failures = probes.filter((p) => p.ratio < p.required)
      const report = failures
        .map((f) => `  ${f.ratio}:1 (needs ${f.required}) ${f.selector} — "${f.text}"`)
        .join('\n')
      expect(failures, `${label} / ${theme}:\n${report}`).toHaveLength(0)
    })
  }
}
