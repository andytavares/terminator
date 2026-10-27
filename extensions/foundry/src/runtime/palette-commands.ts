import * as path from 'node:path'
import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'

import { paletteEntries } from './palette.js'

import { runtime } from './runtime-state.js'

// The palette's entries, rebuilt when what is running changes: the host takes a fixed
// contribution list. One entry per live run and per queued diff, rebuilt only when
// the text would differ.
let paletteRegistrations: Disposable[] = []
let paletteSignature = ''
let paletteTimer: NodeJS.Timeout | null = null

// Take me to the run: the window first, then its terminal while it has one, else the
// panel opened on it. Shared by the palette and a notification click, the same request.
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
  api.window.broadcast('foundry:palette-goto', { kind, sessionId, orderId: orderOfRun(sessionId) })
}

/** The order a supervised run belongs to: its feature folder is named after it. */
function orderOfRun(sessionId: string): string | undefined {
  const run = runtime.supervision?.snapshot().runs.find((r) => r.sessionId === sessionId)
  return run === undefined ? undefined : path.basename(run.featureDir)
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

// Kept in step with the register on a timer: nothing subscribes to the registry, and
// a palette a few seconds behind beats one listing a run that ended.
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
