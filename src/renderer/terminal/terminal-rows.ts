import { useSessionStore } from '../stores/session.store'

declare global {
  interface Window {
    /** Read by the end-to-end specs. See `exposeTerminalRows`. */
    terminatorE2E?: { terminalRows(): string[] }
  }
}

/**
 * Lets the end-to-end specs read what the terminals show. The WebGL renderer
 * draws into a canvas and leaves no text in the DOM, so the specs read each
 * terminal's xterm buffer here instead, which is the same under every renderer.
 */
export function exposeTerminalRows(): void {
  window.terminatorE2E = {
    terminalRows: () =>
      [...useSessionStore.getState().terminalInstances.values()].flatMap((terminal) =>
        terminal.readVisibleRows()
      ),
  }
}
