import { useSessionStore } from '../stores/session.store'

declare global {
  interface Window {
    /** Read by the end-to-end specs. See `exposeTerminalRows`. */
    terminatorE2E?: {
      terminalRows(): string[]
      terminalRowsIn(element: Element): string[]
    }
  }
}

const openTerminals = () => [...useSessionStore.getState().terminalInstances.values()]

/** The rows of the one terminal drawn in `element`, such as a pane's `.xterm-screen`. */
function terminalRowsIn(element: Element): string[] {
  const terminal = openTerminals().find((open) => open.element.contains(element))
  if (!terminal) throw new Error('no open terminal draws in this element')
  return terminal.readVisibleRows()
}

/**
 * Lets the end-to-end specs read what the terminals show. The WebGL renderer
 * draws into a canvas and leaves no text in the DOM, so the specs read each
 * terminal's xterm buffer here instead, which is the same under every renderer.
 * `terminalRows` reads every open terminal, one after another; a spec that
 * needs a row's place on screen reads one pane's terminal with `terminalRowsIn`.
 */
export function exposeTerminalRows(): void {
  window.terminatorE2E = {
    terminalRows: () => openTerminals().flatMap((terminal) => terminal.readVisibleRows()),
    terminalRowsIn,
  }
}
