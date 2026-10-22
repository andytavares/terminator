/**
 * Activates Foundry over a host from `foundry-host.ts`.
 *
 * Foundry's entry is imported here, statically, so a spec that activates it
 * loads every module of the extension while the spec file itself loads. When
 * the first hook or test to activate it imported the entry instead, that cold
 * load — some 160 modules transformed and evaluated — ran inside the hook's
 * 10 s or the test's 5 s, and on a busy machine (four vitest processes on four
 * cores) it took longer than either.
 */
import { eventually } from '../../../../tests/support/eventually'
import { activate } from '../../src/index.ts'
import { runtime } from '../../src/runtime/runtime-state.ts'
import { settleProofs } from '../../src/line/baseline.ts'
import { settleRuns } from '../../src/line/run-control.ts'
import type { FoundryHost } from './foundry-host.js'

export { deactivate } from '../../src/index.ts'

/** Activates Foundry over the host and waits for the supervision runtime, so a spec's first call
 * finds the runner the way a call minutes after start does. */
export async function activateFoundry(host: FoundryHost): Promise<void> {
  activate(host.api)
  await eventually(() => {
    if (runtime.supervision === null) throw new Error('the supervision runtime is not up yet')
  })
}

/** Settles once the base-branch proofs and the runs a test started have ended: each writes into
 * the records until it does, so a test that shares the activation awaits it before the next. */
export async function settleFoundryWork(): Promise<void> {
  await Promise.all([settleProofs(), settleRuns()])
}
