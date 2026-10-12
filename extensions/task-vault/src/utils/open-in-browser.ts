/** Opens an address in the person's browser: a view cannot open a window of its own. */
export function openInBrowser(url: string): void {
  window.electronAPI.shell.openExternal(url).catch(() => {})
}
