import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// The outline's parsing and nesting are unit-tested. What only the real app can
// answer is whether the panel is wired to anything: it lives in the notepad's
// own WebContentsView, which the Playwright page cannot see or type into, and
// its click has to reach a CodeMirror view three components away.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** True once the notepad's WebContentsView exists and has finished loading. */
function extensionViewReady(): Promise<boolean> {
  return handle.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .some((wc) => !wc.isDestroyed() && wc.getURL().startsWith('ext://') && !wc.isLoading())
  )
}

/**
 * Runs a script inside a notepad view and returns its result. `where` picks the
 * surface: the docked panel, or the pop-out note window, which is a second
 * webContents on the same ext:// origin.
 */
function inNotepad<T>(script: string, where: 'panel' | 'window' = 'panel'): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { src, target }) => {
      const views = webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.getURL().startsWith('ext://'))
      const view = views.find((wc) =>
        target === 'window' ? wc.getURL().includes('view=note') : !wc.getURL().includes('view=note')
      )
      if (!view) throw new Error(`no notepad ${target} view is loaded`)
      return view.executeJavaScript(src) as Promise<unknown>
    },
    { src: script, target: where }
  ) as Promise<T>
}

// Long enough that the editor genuinely has to scroll — a note that fits on
// screen cannot tell a working jump from a no-op.
const FILLER = Array.from({ length: 40 }, (_, i) => `Body line ${i}.`).join('\n')
const BODY = [
  '# Alpha',
  FILLER,
  '## Beta',
  FILLER,
  '```md',
  '# Fenced, not a heading',
  '```',
  '## Omega',
  FILLER,
].join('\n')

test.beforeAll(async () => {
  const { page } = handle
  await page.locator('.app-band__entry[aria-label="Notes"]').click()
  await expect
    .poll(extensionViewReady, { timeout: 20000, message: 'notepad view never finished loading' })
    .toBe(true)

  // Seeded through the extension's own bridge: typing markdown through
  // synthetic key events would be exercising the input plumbing, not this.
  await handle.app.evaluate(async ({ webContents }, body) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().startsWith('ext://'))
    if (!view) throw new Error('no notepad view is loaded')
    await view.executeJavaScript(
      `window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.create', ${JSON.stringify(
        { title: 'Outline fixture', body }
      )})`
    )
    view.reload()
  }, BODY)
  await expect.poll(extensionViewReady, { timeout: 20000 }).toBe(true)

  await inNotepad(`(async () => {
    const row = document.querySelector('.notepad-note-list__notes button, [class*="note-row"]')
    if (row) row.click()
    await new Promise((r) => setTimeout(r, 1500))
  })()`)
})

test('the rail lists the open note headings, nested by level', async () => {
  const items = await inNotepad<{ text: string; depth: string }[]>(
    `[...document.querySelectorAll('.notepad-outline__item')].map((el) => ({
       text: el.textContent, depth: el.style.getPropertyValue('--outline-depth'),
     }))`
  )
  expect(items).toEqual([
    { text: 'Alpha', depth: '0' },
    { text: 'Beta', depth: '1' },
    { text: 'Omega', depth: '1' },
  ])
})

test('clicking a heading scrolls the editor to it', async () => {
  const scroll = await inNotepad<{ before: number; afterOmega: number; afterAlpha: number }>(
    `(async () => {
       const scroller = document.querySelector('.cm-scroller')
       const items = [...document.querySelectorAll('.notepad-outline__item')]
       const click = async (label) => {
         items.find((el) => el.textContent === label).click()
         await new Promise((r) => setTimeout(r, 900))
         return scroller.scrollTop
       }
       const before = scroller.scrollTop
       const afterOmega = await click('Omega')
       const afterAlpha = await click('Alpha')
       return { before, afterOmega, afterAlpha }
     })()`
  )
  expect(scroll.before).toBe(0)
  expect(scroll.afterOmega).toBeGreaterThan(500)
  // Back to the top of the document, not merely somewhere above Omega.
  expect(scroll.afterAlpha).toBeLessThan(100)
})

test('the outline sits in the right rail, above the comments', async () => {
  const order = await inNotepad<string[]>(
    `[...document.querySelector('.notepad-view__rail').children].map((el) => el.className)`
  )
  expect(order[0]).toContain('notepad-outline')
  expect(order[1]).toContain('notepad-view__comments')
})

test('the rail splits evenly between the outline and the comments', async () => {
  // The outline sized itself to its headings, so a long note pushed the
  // comments into a sliver. Neither panel gets to grow at the other's expense.
  const heights = await inNotepad<{ outline: number; comments: number; rail: number }>(
    `(() => {
       const rect = (sel) => document.querySelector(sel).getBoundingClientRect().height
       return {
         outline: rect('.notepad-outline'),
         comments: rect('.notepad-view__comments'),
         rail: rect('.notepad-view__rail'),
       }
     })()`
  )
  expect(Math.abs(heights.outline - heights.comments)).toBeLessThan(2)
  expect(heights.outline + heights.comments).toBeCloseTo(heights.rail, 0)
})

test('one panel takes the whole rail when the other is closed', async () => {
  const height = await inNotepad<{ comments: number; rail: number }>(
    `(async () => {
       const byLabel = (text) =>
         [...document.querySelectorAll('.notepad-view__toolbar button')]
           .find((b) => b.textContent === text)
       byLabel('Hide outline').click()
       await new Promise((r) => setTimeout(r, 300))
       const rect = (sel) => document.querySelector(sel).getBoundingClientRect().height
       const out = { comments: rect('.notepad-view__comments'), rail: rect('.notepad-view__rail') }
       byLabel('Outline').click()
       await new Promise((r) => setTimeout(r, 300))
       return out
     })()`
  )
  expect(height.comments).toBeCloseTo(height.rail, 0)
})

test('the outline closes from the panel and comes back from the toolbar', async () => {
  const states = await inNotepad<{ open: number; closed: number; reopened: number }>(
    `(async () => {
       const count = () => document.querySelectorAll('.notepad-outline__item').length
       const open = count()

       document.querySelector('[aria-label="Close outline"]').click()
       await new Promise((r) => setTimeout(r, 300))
       const closed = count()

       const toolbarBtn = [...document.querySelectorAll('.notepad-view__toolbar button')]
         .find((b) => b.textContent === 'Outline')
       toolbarBtn.click()
       await new Promise((r) => setTimeout(r, 300))
       return { open, closed, reopened: count() }
     })()`
  )
  expect(states).toEqual({ open: 3, closed: 0, reopened: 3 })
})

test('closing both rail panels gives the width back to the editor', async () => {
  const widths = await inNotepad<{ withRail: number; withoutRail: number }>(
    `(async () => {
       const editor = document.querySelector('.notepad-view__editor')
       const byLabel = (text) =>
         [...document.querySelectorAll('.notepad-view__toolbar button')]
           .find((b) => b.textContent === text)
       const withRail = editor.getBoundingClientRect().width
       byLabel('Hide outline').click()
       byLabel('Hide comments').click()
       await new Promise((r) => setTimeout(r, 400))
       const withoutRail = editor.getBoundingClientRect().width
       // Put it back for whatever runs next.
       byLabel('Outline').click()
       byLabel('Show comments').click()
       await new Promise((r) => setTimeout(r, 300))
       return { withRail, withoutRail }
     })()`
  )
  expect(widths.withoutRail).toBeGreaterThan(widths.withRail + 200)
})

test('a popped-out note window gets the same outline', async () => {
  await inNotepad(
    `window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.list', {}).then((r) =>
       window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.openWindow', {
         id: r.data[0].id,
       })
     )`
  )
  // The auxiliary window loads its own copy of the extension renderer.
  await expect
    .poll(
      () =>
        handle.app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((wc) => !wc.isDestroyed() && wc.getURL().includes('view=note') && !wc.isLoading())
        ),
      { timeout: 20000, message: 'note window never finished loading' }
    )
    .toBe(true)

  const items = await inNotepad<string[]>(
    `(async () => {
       await new Promise((r) => setTimeout(r, 1500))
       return [...document.querySelectorAll('.notepad-outline__item')].map((el) => el.textContent)
     })()`,
    'window'
  )
  expect(items).toEqual(['Alpha', 'Beta', 'Omega'])
})
