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

const openTerminalInstances = () => [...useSessionStore.getState().terminalInstances.values()]

/** The rows of the one terminal drawn in `element`, such as a pane's `.xterm-screen`. */
function rowsOfTerminalIn(element: Element): string[] {
  const terminal = openTerminalInstances().find((open) => open.element.contains(element))
  if (!terminal) throw new Error('no open terminal draws in this element')
  return terminal.readVisibleRows()
}

/** Lets the e2e specs read the terminals' xterm buffers, as WebGL leaves no text in the DOM:
 * `terminalRows` reads every open terminal in turn, `terminalRowsIn` one pane's, for a spec that
 * needs a row's place on screen. */
export function exposeTerminalRows(): void {
  window.terminatorE2E = {
    terminalRows: () => openTerminalInstances().flatMap((terminal) => terminal.readVisibleRows()),
    terminalRowsIn: rowsOfTerminalIn,
  }
}
