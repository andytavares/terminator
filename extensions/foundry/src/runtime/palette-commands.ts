import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'

import { paletteEntries } from './palette.js'

import { runtime } from './runtime-state.js'

/**
 * The palette's current entries, disposed and rebuilt when what is running
 * changes.
 *
 * The host takes a fixed contribution list, so keeping runs in the palette
 * means re-registering rather than answering a query. Cheap: the list is one
 * entry per live run and one per queued diff, and it only rebuilds when the
 * text would actually differ.
 */
let paletteRegistrations: Disposable[] = []
let paletteSignature = ''
let paletteTimer: NodeJS.Timeout | null = null

/**
 * Puts what is running one keystroke away.
 *
 * Three surfaces answer the same question — what needs me, ranked — and this is
 * the one you reach without moving your hands.
 */
/**
 * Take me to the run this is about.
 *
 * The window first: navigation that changes what is on screen behind another
 * window has done nothing you can see. Then the terminal it is actually in,
 * when it still has one — that is where the agent is and where you can type at
 * it. A run that has ended has no terminal, so the panel opened on it is the
 * closest thing to the same place.
 *
 * Shared by the command palette and by clicking a notification, because they
 * are the same request phrased twice, and two copies would drift.
 */
export function gotoRun(api: ExtensionAPI, kind: 'run', sessionId: string): void {
  api.window.focusSelf()
  const terminal = runtime.supervisedRunner?.terminalFor(sessionId) ?? null
  if (terminal !== null) {
    // Through the core's own navigation: it selects the workspace, the project
    // and the tab, none of which this extension's separate renderer can do.
    api.window.broadcast('terminal:navigate-to-session', {
      sessionId: terminal.terminalSessionId,
      projectId: terminal.projectId,
    })
    return
  }
  api.window.broadcast('foundry:palette-goto', { kind, sessionId })
}

function refreshPalette(api: ExtensionAPI): void {
  const snapshot = runtime.supervision?.snapshot() ?? null
  const entries = snapshot === null ? [] : paletteEntries(snapshot.runs)
  // Rebuilt only when it would read differently, so an open palette is not
  // re-registered under the cursor every tick.
  const signature = entries.map((e) => `${e.id}:${e.description}`).join('|')
  if (signature === paletteSignature) return
  paletteSignature = signature

  for (const registration of paletteRegistrations) registration.dispose()
  paletteRegistrations = entries.map((entry, index) => {
    // Only the single most urgent entry — already worst-state-first — gets the
    // group's 'w' mnemonic; the rest are reachable through search.
    const urgent = index === 0
    const label =
      urgent && (entry.state === 'waiting' || entry.state === 'stalled')
        ? 'Go to the run waiting on you'
        : entry.label
    return api.commands.register(
      {
        id: entry.id,
        label,
        description: entry.description,
        category: entry.category,
        mnemonic: urgent ? 'w' : undefined,
      },
      () => gotoRun(api, entry.kind, entry.sessionId)
    )
  })
}

/**
 * Kept in step with the register on a timer rather than an event: the
 * registry is read by everything and subscribed to by nothing, and a palette
 * that lists a run which ended is worse than one a few seconds behind.
 */
export function startPaletteRefresh(api: ExtensionAPI): void {
  refreshPalette(api)
  paletteTimer = setInterval(() => refreshPalette(api), 5_000)
}

export function stopPaletteRefresh(): void {
  if (paletteTimer !== null) clearInterval(paletteTimer)
  paletteTimer = null
  for (const registration of paletteRegistrations) registration.dispose()
  paletteRegistrations = []
  paletteSignature = ''
}
