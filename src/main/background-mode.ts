import { app, type BrowserWindowConstructorOptions } from 'electron'

// Set by the e2e harness, so a test run never takes the screen, the Dock or the keyboard from
// whoever is using the machine. Windows stay hidden but keep drawing, which is what lets a test
// still click, type into and screenshot them (Electron's "Page visibility" docs).
const RUNS_IN_BACKGROUND = process.env.TERMINATOR_RUN_IN_BACKGROUND === '1'

export function runsInBackground(): boolean {
  return RUNS_IN_BACKGROUND
}

/** A window's options; in the background it is created hidden and never stops drawing. */
export function windowOptions(
  options: BrowserWindowConstructorOptions
): BrowserWindowConstructorOptions {
  if (!RUNS_IN_BACKGROUND) return options
  return {
    ...options,
    show: false,
    webPreferences: { ...options.webPreferences, backgroundThrottling: false },
  }
}

/** Shows and focuses a window, unless the app runs in the background. */
export function revealWindow(window: { show: () => void; focus: () => void }): void {
  if (RUNS_IN_BACKGROUND) return
  window.show()
  window.focus()
}

/** Focuses a window without showing it, unless the app runs in the background. */
export function focusWindow(window: { focus: () => void }): void {
  if (!RUNS_IN_BACKGROUND) window.focus()
}

/** Keeps the app out of the Dock and the menu bar, so launching it never makes it the active app. */
export function enterBackgroundMode(platform: NodeJS.Platform = process.platform): void {
  if (RUNS_IN_BACKGROUND && platform === 'darwin') app.setActivationPolicy('accessory')
}
