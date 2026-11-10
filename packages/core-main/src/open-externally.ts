import { shell } from 'electron'

/** Opens an http(s) URL in the default browser; anything else is ignored. */
export function openExternally(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url).catch(() => {})
  }
}
