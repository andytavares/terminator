import type { ForgeDeps } from '../../src/ipc/forge-channels.js'

/** The seams a host always supplies, answering as a host with nothing configured would. */
export function quietForgeSeams(
  dataRoot: () => string
): Omit<ForgeDeps, 'store' | 'now' | 'capability' | 'onAgreed'> {
  return {
    dataRoot,
    standingSources: { gatesFor: async () => [] },
    readIssue: async () => null,
    writeBackDefault: () => [],
    budgetDefaults: () => ({ agents: 3, wallClockMinutes: 45 }),
    criticalPaths: () => [],
    priorArtFor: async () => [],
    converge: async () => ({ ok: false, reason: 'no architect runs in this test' }),
    queueEntries: async () => [],
    onReleased: () => undefined,
  }
}
