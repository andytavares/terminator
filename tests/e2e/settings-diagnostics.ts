import type { AppHandle } from './helpers'

// TEMPORARY (PR #269): records what opens, closes and re-sections Settings and where focus goes,
// to find why Settings ends up on Appearance after the Extensions click on CI. Remove with the fix.

// Runs in the host page as a script tag, so it is plain JavaScript.
const PAGE_PROBE = `(() => {
  if (window.settingsDiag) return
  const log = (window.settingsDiag = [])
  const note = (line) => log.push(Date.now() + ' ' + line)
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
      if (record.attributeName === 'open') note('dialog open=' + target.open)
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open'] })
  window.addEventListener('focusin', (e) => note('focusin ' + describe(e.target)), true)
  window.addEventListener('blur', () => note('host window blur, active ' + describe(document.activeElement)))
  window.addEventListener('focus', () => note('host window focus'))
  window.addEventListener('keydown', (e) =>
    note('keydown ' + (e.metaKey ? 'Meta+' : '') + (e.ctrlKey ? 'Ctrl+' : '') + e.key + ' on ' + describe(e.target)), true)
  for (const type of ['mousedown', 'cancel', 'close'])
    document.addEventListener(type, (e) => note(type + ' on ' + describe(e.target)), true)
})()`

export async function installSettingsDiagnostics(handle: AppHandle): Promise<void> {
  await handle.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const g = globalThis as unknown as { settingsDiag?: string[] }
    if (!win || g.settingsDiag) return
    const log: string[] = (g.settingsDiag = [])
    const send = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel.startsWith('menu:') || channel === 'extension:focus-view') {
        log.push(`${Date.now()} main→renderer ${channel} ${JSON.stringify(args[0] ?? '')}`)
      }
      return send(channel, ...args)
    }
    win.on('focus', () => log.push(`${Date.now()} window focus`))
    win.on('blur', () => log.push(`${Date.now()} window blur`))
  })
  await handle.page.addScriptTag({ content: PAGE_PROBE })
}

export async function settingsDiagnostics(handle: AppHandle): Promise<string> {
  const page = await handle.page.evaluate(
    () => (window as unknown as { settingsDiag?: string[] }).settingsDiag ?? []
  )
  const main = await handle.app.evaluate(
    () => (globalThis as unknown as { settingsDiag?: string[] }).settingsDiag ?? []
  )
  return [...page, ...main].sort().join('\n')
}
