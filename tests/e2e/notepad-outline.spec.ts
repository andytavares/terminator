import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, inExtensionView } from './helpers'
import { extensionFrame } from './extension-page'

// The outline's parsing and nesting are unit-tested. What only the real app can
// answer is whether the panel is wired to anything: it lives in the notepad's
// own frame in the main window, and its click has to reach a CodeMirror view
// three components away.

let handle: AppHandle

/** Creates the fixture note and reloads the frame. Seeded through the
 * extension's own bridge: typing markdown through synthetic key events would
 * be exercising the input plumbing, not this. */
async function seedOutlineNote(): Promise<void> {
  const frame = extensionFrame(handle, 'notepad')
  if (!frame) throw new Error('no notepad frame is loaded')
  await frame.evaluate(
    (body) =>
      window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.create', {
        title: 'Outline fixture',
        body,
      }),
    BODY
  )
  await frame.evaluate(() => {
    location.reload()
  })
}

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** True once the notepad's frame exists and has finished loading. */
async function extensionViewReady(): Promise<boolean> {
  const frame = extensionFrame(handle, 'notepad')
  if (!frame) return false
  return frame.evaluate(() => document.readyState === 'complete').catch(() => false)
}

/**
 * Runs a script inside a notepad view and returns its result. `where` picks the
 * surface: the docked panel (a frame in the main window), or the pop-out note
 * window, which is a real BrowserWindow loading the same ext:// URL directly.
 */
function inNotepad<T>(script: string, where: 'panel' | 'window' = 'panel'): Promise<T> {
  if (where === 'panel') {
    return inExtensionView<T>(handle, 'notepad/dist/index.html?view=main', script)
  }
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('view=note'))
    if (!view) throw new Error('no notepad window view is loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
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

  await seedOutlineNote()
  await expect.poll(extensionViewReady, { timeout: 20000 }).toBe(true)

  await expect
    .poll(() =>
      inNotepad<boolean>(`(() => {
    const row = document.querySelector('.notepad-note-list__notes button, [class*="note-row"]')
    if (row) row.click()
    return !!row
  })()`)
    )
    .toBe(true)
  await expect
    .poll(() => inNotepad<number>(`document.querySelectorAll('.notepad-outline__item').length`))
    .toBeGreaterThan(0)
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
         let prev = scroller.scrollTop
         for (let i = 0; i < 60; i++) {
           await new Promise((r) => requestAnimationFrame(r))
           const cur = scroller.scrollTop
           if (cur === prev) break
           prev = cur
         }
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
       const byLabel = (name) =>
         document.querySelector('.notepad-view__toolbar [aria-label="' + name + '"]')
       const rect = (sel) => document.querySelector(sel).getBoundingClientRect().height
       byLabel('Outline').click()
       let out = { comments: rect('.notepad-view__comments'), rail: rect('.notepad-view__rail') }
       for (let i = 0; i < 30; i++) {
         await new Promise((r) => requestAnimationFrame(r))
         out = { comments: rect('.notepad-view__comments'), rail: rect('.notepad-view__rail') }
         if (Math.abs(out.comments - out.rail) < 2) break
       }
       byLabel('Outline').click()
       for (let i = 0; i < 30; i++) {
         await new Promise((r) => requestAnimationFrame(r))
         if (document.querySelectorAll('.notepad-outline__item').length > 0) break
       }
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
       for (let i = 0; i < 30 && count() !== 0; i++) await new Promise((r) => requestAnimationFrame(r))
       const closed = count()

       const toolbarBtn = document.querySelector('.notepad-view__toolbar [aria-label="Outline"]')
       toolbarBtn.click()
       for (let i = 0; i < 30 && count() === 0; i++) await new Promise((r) => requestAnimationFrame(r))
       return { open, closed, reopened: count() }
     })()`
  )
  expect(states).toEqual({ open: 3, closed: 0, reopened: 3 })
})

test('closing both rail panels gives the width back to the editor', async () => {
  const widths = await inNotepad<{ withRail: number; withoutRail: number }>(
    `(async () => {
       const editor = document.querySelector('.notepad-view__editor')
       const byLabel = (name) =>
         document.querySelector('.notepad-view__toolbar [aria-label="' + name + '"]')
       const withRail = editor.getBoundingClientRect().width
       byLabel('Outline').click()
       byLabel('Comments').click()
       let withoutRail = editor.getBoundingClientRect().width
       for (let i = 0; i < 30 && withoutRail <= withRail + 200; i++) {
         await new Promise((r) => requestAnimationFrame(r))
         withoutRail = editor.getBoundingClientRect().width
       }
       // Put it back for whatever runs next.
       byLabel('Outline').click()
       byLabel('Comments').click()
       for (let i = 0; i < 30; i++) {
         await new Promise((r) => requestAnimationFrame(r))
         if (document.querySelectorAll('.notepad-outline__item').length > 0) break
       }
       return { withRail, withoutRail }
     })()`
  )
  expect(widths.withoutRail).toBeGreaterThan(widths.withRail + 200)
})

/** Whether a popped-out note window has finished loading. */
function noteWindowLoaded(): Promise<boolean> {
  return handle.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .some((wc) => !wc.isDestroyed() && wc.getURL().includes('view=note') && !wc.isLoading())
  )
}

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
    .poll(noteWindowLoaded, { timeout: 20000, message: 'note window never finished loading' })
    .toBe(true)

  // Loaded is not rendered: the window still fetches the note over the bridge.
  await expect
    .poll(() =>
      inNotepad<string[]>(
        `[...document.querySelectorAll('.notepad-outline__item')].map((el) => el.textContent)`,
        'window'
      )
    )
    .toEqual(['Alpha', 'Beta', 'Omega'])
})
