import { createLedgerChannels, ledgerChannelSpecs } from './ledger-channels.js'
import { createSensorChannels, sensorChannelSpecs } from './sensor-channels.js'
import { newOrderId } from '../forge/intake-source.js'
import type { SignalStore } from '../sensors/store.js'
import { rulesFor } from '../verify/rules.js'
import { availableNames, availableSensors, resolveRule } from '../recipe/resolve.js'
import { createLiveOrderStore } from '../order/store.js'

import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { resolveSources } from '../workspace-root.js'
import { indexFor } from '../state/live-index.js'
import { sensorCollectDepsFor } from '../sensors/sensor-tick.js'

/** The record (the ledger) and the signals the sensors collect. */
export function registerRecordChannels(context: ActivationContext, signalStore: SignalStore): void {
  registerLedger(context)
  registerSensors(context, signalStore)
}

function registerLedger({ api, dataRoot }: ActivationContext): void {
  // ── The record ─────────────────────────────────────────────────────────
  //
  // Every decision, by whom or by what rule, and why. The one place the
  // factory ever argues back — and only when asked: `rules.propose` is a
  // channel the operator's own button reaches, never a subscription and never
  // anything the append path can trigger.
  const ledger = createLedgerChannels({
    store: createLiveOrderStore(dataRoot, indexFor),
    dataRoot,
    index: indexFor,
    existingRuleIds: () => {
      const sources = resolveSources(api, dataRoot())
      return rulesFor(sources, { repoPaths: sources.repoPaths, houseDocs: [] }).rules.map(
        (rule) => rule.id
      )
    },
    // Read by rung rather than by applicability: a check the operator accepted
    // is theirs to remove whether or not it applies to the repository they
    // happen to have open.
    acceptedRules: () => {
      const sources = resolveSources(api, dataRoot())
      return availableNames('rules', sources).flatMap((name) => {
        const resolved = resolveRule(name, sources)
        if (!resolved.ok || resolved.resolved.rung !== 'data-root') return []
        return [
          {
            id: resolved.resolved.value.id,
            asserts: resolved.resolved.value.asserts,
            rung: resolved.resolved.rung,
            origin: resolved.resolved.value.origin,
          },
        ]
      })
    },
    sources: () => resolveSources(api, dataRoot()),
    now: () => new Date().toISOString(),
  })
  reg(api, ...ledgerChannelSpecs(ledger))
}

function registerSensors({ api, dataRoot }: ActivationContext, signalStore: SignalStore): void {
  // ── Signals (ADR-066) ────────────────────────────────────────────────────
  const sensors = createSensorChannels({
    store: signalStore,
    orderStore: createLiveOrderStore(dataRoot, indexFor),
    availableSensors: () => availableSensors(resolveSources(api, dataRoot())),
    collectDepsFor: (repoPath) => sensorCollectDepsFor(api, repoPath),
    now: () => new Date().toISOString(),
    newId: () => newOrderId(new Date()),
  })
  reg(api, ...sensorChannelSpecs(sensors))
}
