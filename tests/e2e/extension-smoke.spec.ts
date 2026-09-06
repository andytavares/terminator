import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * Open every extension surface, including the ones behind a disclosure, and
 * assert nothing throws and nothing renders as a bare browser control.
 *
 * This exists because of what it would have caught. Remote Control's settings
 * section referenced an `enabled` identifier that its own redesign had deleted
 * — a ReferenceError at render, which unmounts the React tree and leaves a
 * black panel with no way back. Every unit test passed, the contrast harness
 * passed, and the e2e that clicked the disclosure read the resulting empty
 * document as "the click did not register".
 *
 * Three whole-class checks, run on each surface:
 *   1. Nothing threw.
 *   2. Every input carries a real background — a control with browser defaults
 *      is a white box on a dark panel.
 *   3. No icon is drawn at lucide's 24px fallback in a 12px context.
 */

let handle: AppHandle

const SURFACES: { id: string; label: string; part: string; expand?: string }[] = [
  {
    id: 'terminator.remote-control',
    label: 'Remote Control',
    part: 'remote-control',
    expand: 'settings',
  },
  { id: 'terminator.notepad', label: 'Notes', part: 'notepad' },
  { id: 'terminator.task-vault', label: 'Task Vault', part: 'task-vault' },
  { id: 'terminator.foundry', label: 'Foundry', part: 'foundry' },
]

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await handle.page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await closeApp(handle)
})

function inView<T>(part: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { p, src }) => {
      const v = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes(p))
      if (!v) throw new Error(`no view for ${p}`)
      return v.executeJavaScript(src) as Promise<unknown>
    },
    { p: part, src: script }
  ) as Promise<T>
}

for (const { id, label, part, expand } of SURFACES) {
  test(`${label} renders, and everything on it is styled`, async () => {
    const panel = handle.page.locator(`[data-extension-panel="${id}"]`)
    if ((await panel.count()) === 0) {
      await handle.page.locator(`button[aria-label="${label}"]`).click()
    }
    await expect(panel).toHaveCount(1, { timeout: 20000 })
    await handle.page.waitForTimeout(2500)

    await inView(
      part,
      `(() => {
        window.__thrown = []
        window.addEventListener('error', (e) => window.__thrown.push(String(e.message)))
        return true
      })()`
    )

    // Anything behind a disclosure is a surface too, and the one that broke.
    if (expand) {
      const before = await inView<number>(part, 'document.body.innerText.length')
      const opened = await inView<boolean>(
        part,
        `(function () {
          var all = document.querySelectorAll('button')
          for (var i = 0; i < all.length; i++) {
            var text = (all[i].textContent || '') + ' ' + (all[i].getAttribute('aria-label') || '')
            if (/${expand}/i.test(text)) { all[i].click(); return true }
          }
          return false
        })()`
      )
      // A test that cannot reach the surface must say so rather than pass on
      // the default screen — which is how a crashing settings panel and two
      // unstyled inputs both went unnoticed here.
      expect(opened, `${label}: found no control matching /${expand}/i to open`).toBe(true)
      await handle.page.waitForTimeout(2000)
      const after = await inView<number>(part, 'document.body.innerText.length')
      expect(after, `${label}: opening "${expand}" changed nothing on screen`).not.toBe(before)
    }

    const report = await inView<{
      thrown: string[]
      bodyLength: number
      unstyledInputs: string[]
      oversizedIcons: string[]
      bareButtons: string[]
      sideScrollers: string[]
    }>(
      part,
      `(() => {
        const unstyled = []
        for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select')) {
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          const cs = getComputedStyle(el)
          // What a control looks like when nothing has styled it: Chromium
          // paints a white field with an inset border. A transparent input on
          // a styled bar is a deliberate pattern and passes — the test is for
          // the default rendering, not for the absence of a background.
          const whiteField = cs.backgroundColor === 'rgb(255, 255, 255)'
          const insetBorder = cs.borderTopStyle === 'inset'
          if (whiteField || insetBorder) {
            unstyled.push(
              (el.className || el.tagName) + ' [' + cs.backgroundColor + ' / ' + cs.borderTopStyle + ']'
            )
          }
        }
        // No button renders the browser's native control. A modifier that
        // forgets a background used to produce a white pill on a dark panel.
        const bareButtons = []
        for (const el of document.querySelectorAll('button')) {
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          const cs = getComputedStyle(el)
          if (cs.appearance === 'auto' || cs.borderTopStyle === 'outset') {
            bareButtons.push((el.className || el.getAttribute('aria-label') || 'button').toString().split(' ')[0])
          }
        }
        // A dialog scrolls down, never sideways — its own title and close
        // control are the first things to leave when it does.
        const sideScrollers = []
        for (const el of document.querySelectorAll('.tmui-dialog__panel, [role=dialog]')) {
          if (el.scrollWidth - el.clientWidth > 1) {
            sideScrollers.push(
              (el.className || 'dialog') + ' overflows by ' + (el.scrollWidth - el.clientWidth) + 'px'
            )
          }
        }
        const oversized = []
        for (const svg of document.querySelectorAll('svg')) {
          const r = svg.getBoundingClientRect()
          // 24px is lucide's fallback when nothing sized it. A deliberate
          // 36px empty-state glyph is a choice; this is looking for the
          // absence of one.
          if (Math.round(r.height) === 24) {
            oversized.push((svg.parentElement?.className || svg.tagName) + ' 24px')
          }
        }
        return {
          bareButtons,
          sideScrollers,
          thrown: window.__thrown || [],
          bodyLength: document.body.innerText.length,
          unstyledInputs: unstyled,
          oversizedIcons: oversized,
        }
      })()`
    )

    expect(report.thrown, `${label} threw while rendering`).toHaveLength(0)
    expect(report.bodyLength, `${label} rendered an empty document`).toBeGreaterThan(20)
    expect(
      report.unstyledInputs,
      `${label} has controls with browser-default styling: ${report.unstyledInputs.join(', ')}`
    ).toHaveLength(0)
    expect(
      report.bareButtons,
      `${label} has buttons rendering the browser's native control: ${report.bareButtons.join(', ')}`
    ).toHaveLength(0)
    expect(
      report.sideScrollers,
      `${label} has a dialog that scrolls sideways: ${report.sideScrollers.join(', ')}`
    ).toHaveLength(0)
    expect(
      report.oversizedIcons,
      `${label} draws icons at lucide's 24px fallback (nothing sized them): ${report.oversizedIcons.join(', ')}`
    ).toHaveLength(0)
  })
}
