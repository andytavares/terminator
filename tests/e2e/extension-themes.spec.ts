import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'
import { CONTRAST_PROBE, type Probe } from './contrast-probe'

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

const LABELS: Record<string, string> = {
  'terminator.foundry': 'Foundry',
  'terminator.task-vault': 'Task Vault',
  'terminator.notepad': 'Notes',
  'terminator.remote-control': 'Remote Control',
}

const SURFACES: { id: string; label: string; urlPart: string }[] = [
  { id: 'terminator.foundry', label: 'Foundry', urlPart: 'foundry' },
  { id: 'terminator.task-vault', label: 'Task Vault', urlPart: 'task-vault' },
  { id: 'terminator.notepad', label: 'Notepad', urlPart: 'notepad' },
  { id: 'terminator.remote-control', label: 'Remote Control', urlPart: 'remote-control' },
]

test('an extension view follows the app into the light theme', async () => {
  await openExtension('terminator.foundry', 'foundry')

  await setTheme('light')
  const light = await inView<string | null>(
    'foundry',
    "document.documentElement.getAttribute('data-theme')"
  )
  expect(light).toBe('light')

  // The attribute is only useful if it actually repaints. Dark's base is
  // #0c0c0f and light's is #f0f0f5, so the body's own ground has to change.
  const lightBg = await inView<string>('foundry', 'getComputedStyle(document.body).backgroundColor')

  await setTheme('dark')
  const dark = await inView<string | null>(
    'foundry',
    "document.documentElement.getAttribute('data-theme')"
  )
  expect(dark).not.toBe('light')
  const darkBg = await inView<string>('foundry', 'getComputedStyle(document.body).backgroundColor')

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
