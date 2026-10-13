import { createLedgerChannels, ledgerChannelSpecs } from './ledger-channels.js'
import { createSensorChannels, sensorChannelSpecs } from './sensor-channels.js'
import { newOrderId } from '../forge/intake-source.js'
import type { SignalStore } from '../sensors/store.js'
import { rulesFor } from '../verify/rules.js'
import { availableNames, availableSensors, resolveRule } from '../recipe/resolve.js'
import { createLiveOrderStore } from '../order/store.js'

import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { resolveSources, sourcesOf } from '../workspace-root.js'
import { indexFor } from '../state/live-index.js'
import { sensorCollectDepsFor } from '../sensors/sensor-tick.js'
import { isoNow } from '../host-calls.js'

/** The record (the ledger) and the signals the sensors collect. */
export function registerRecordChannels(context: ActivationContext, signalStore: SignalStore): void {
  registerLedger(context)
  registerSensors(context, signalStore)
}

function registerLedger({ api, dataRoot }: ActivationContext): void {
  // The record: every decision, by whom or what rule, and why. `rules.propose` is
  // the one place it argues back, reached only by the operator's own button.
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
    acceptedRules: () => acceptedRulesIn(resolveSources(api, dataRoot())),
    sources: sourcesOf({ api, dataRoot }),
    now: isoNow,
  })
  reg(api, ...ledgerChannelSpecs(ledger))
}

function acceptedRulesIn(
  sources: ReturnType<typeof resolveSources>
): ReturnType<Parameters<typeof createLedgerChannels>[0]['acceptedRules']> {
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
}

function registerSensors({ api, dataRoot }: ActivationContext, signalStore: SignalStore): void {
  // ── Signals (ADR-066) ────────────────────────────────────────────────────
  const sensors = createSensorChannels({
    store: signalStore,
    orderStore: createLiveOrderStore(dataRoot, indexFor),
    availableSensors: () => availableSensors(resolveSources(api, dataRoot())),
    collectDepsFor: (repoPath) => sensorCollectDepsFor(api, repoPath),
    now: isoNow,
    newId: () => newOrderId(new Date()),
  })
  reg(api, ...sensorChannelSpecs(sensors))
}
