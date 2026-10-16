import { test, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

// TEMPORARY (PR #269): records where focus and keys go in the host page and in each extension
// frame, and what opens and closes Settings, to find the CI-only focus failures. Remove with the fix.

// Runs in a document as a script, so it is plain JavaScript. `where` names the document.
const probe = (where: string) => `(() => {
  if (window.settingsDiag) return
  const log = (window.settingsDiag = [])
  let lastFrame = performance.now()
  const tick = () => { lastFrame = performance.now(); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const note = (line) => log.push(Date.now() + ' ${where}: ' + line + ' [hasFocus=' + document.hasFocus() +
    ' vis=' + document.visibilityState + ' sinceFrame=' + Math.round(performance.now() - lastFrame) + 'ms]')
  document.addEventListener('visibilitychange', () => note('visibilitychange'))
  const describe = (el) =>
    el && el.tagName ? el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') : String(el)
  const isSettings = (node) => node instanceof Element && node.matches('.settings-panel')
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (isSettings(node)) note('settings mounted')
      for (const node of record.removedNodes) if (isSettings(node)) note('settings unmounted')
      const target = record.target
      if (record.attributeName === 'class' && target.classList.contains('settings-panel__nav-item--active'))
        note('section ' + target.textContent)
      if (record.attributeName === 'open') note('dialog ' + (target.getAttribute('aria-label') || '') + ' open=' + target.open)
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open'] })
  window.addEventListener('focusin', (e) => note('focusin ' + describe(e.target)), true)
  window.addEventListener('blur', () => note('window blur, active ' + describe(document.activeElement)))
  window.addEventListener('focus', () => note('window focus'))
  window.addEventListener('keydown', (e) =>
    note('keydown ' + (e.metaKey ? 'Meta+' : '') + (e.ctrlKey ? 'Ctrl+' : '') + e.key + ' on ' + describe(e.target)), true)
  for (const type of ['mousedown', 'cancel', 'close'])
    document.addEventListener(type, (e) => note(type + ' on ' + describe(e.target)), true)
})()`

/** Main's side writes into the page's log, so one dump holds both. */
export async function installSettingsDiagnostics(
  app: ElectronApplication,
  page: Page
): Promise<void> {
  await page.addScriptTag({ content: probe('host') })
  page.on('framenavigated', (frame) => {
    if (frame.url().startsWith('ext://')) installInFrame(frame).catch(() => undefined)
  })
  await installInMain(app)
}

/** Main's sends and window events, written into the page's log. */
async function installInMain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    const note = (line: string) =>
      void win.webContents
        .executeJavaScript(
          `window.settingsDiag?.push(${JSON.stringify(`${Date.now()} main: ${line}`)})`
        )
        .catch(() => undefined)
    const send = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (/^(menu:|quick-actions:)|^extension:focus-view$/.test(channel)) {
        note(`${channel} ${JSON.stringify(args[0] ?? '')}`)
      }
      return send(channel, ...args)
    }
    for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) {
      win.on(event as 'focus', () =>
        note(`window ${event} (visible=${win.isVisible()} minimized=${win.isMinimized()})`)
      )
    }
    note(`window at install (visible=${win.isVisible()} focused=${win.isFocused()})`)
  })
}

async function installInFrame(frame: Frame): Promise<void> {
  await frame.waitForLoadState('domcontentloaded')
  const name = new URL(frame.url()).hostname.replace('terminator.', '')
  await frame.evaluate(probe(name))
}

export async function markSettingsDiagnostics(page: Page, line: string): Promise<void> {
  await page.evaluate(
    (text) =>
      (window as unknown as { settingsDiag?: string[] }).settingsDiag?.push(
        `${Date.now()} test: ${text}`
      ),
    line
  )
}

const readLog = (target: Page | Frame) =>
  target
    .evaluate(() => (window as unknown as { settingsDiag?: string[] }).settingsDiag ?? [])
    .catch(() => [] as string[])

/** The host's log and every extension frame's, merged in time order. */
async function allLogs(page: Page): Promise<string[]> {
  const frames = page.frames().filter((frame) => frame.url().startsWith('ext://'))
  const logs = await Promise.all([page, ...frames].map(readLog))
  return logs.flat().sort()
}

export async function printSettingsDiagnostics(page: Page): Promise<void> {
  console.log(`settings diagnostics:\n${(await allLogs(page)).join('\n')}`)
}

const READ_DEADLINE_MS = 2_000

/** Writes the launch's log beside the failed tests, which CI uploads as test-results-N. */
export async function saveSettingsDiagnostics(page: Page): Promise<void> {
  const lines = await Promise.race([
    allLogs(page),
    new Promise<string[]>((resolve) =>
      // eslint-disable-next-line no-restricted-syntax
      setTimeout(() => resolve(['read timed out']), READ_DEADLINE_MS)
    ),
  ])
  const directory = join('test-results', 'settings-diagnostics')
  mkdirSync(directory, { recursive: true })
  appendFileSync(join(directory, `${basename(test.info().file)}.log`), `${lines.join('\n')}\n---\n`)
}
