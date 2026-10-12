import type { ExtensionAPI } from '@terminator/extension-sdk'
import { randomUUID } from 'node:crypto'

import { createSignalStore } from './store.js'
import type { SignalStore } from './store.js'
import { dueSensors, runSensor } from './schedule.js'
import type { CollectDeps } from './collect.js'
import { availableSensors } from '../recipe/resolve.js'

import type { ActivationContext } from '../ipc/register.js'
import { resolveSources } from '../workspace-root.js'

/**
 * The sensor tick (ADR-066): every due, enabled sensor runs sequentially once
 * a minute while the app is open. Nothing runs when no sensor is enabled —
 * `dueSensors` filters on that before anything is collected.
 */
let sensorTimer: NodeJS.Timeout | null = null

/**
 * The application's tracker connection, narrowed to what a sensor's `tracker`
 * source needs (`collect.ts`).
 */
function sensorIssuesFor(api: ExtensionAPI): CollectDeps['issues'] {
  const issues = api.issues
  return {
    search: async (query, opts) =>
      (await issues.search(query, opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
    listMine: async (opts) =>
      (await issues.listMine(opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
  }
}

/**
 * One `CollectDeps` for a sensor watching `repoPath`, over the extension's own
 * `gh`/`git` exec and tracker connection.
 */
export function sensorCollectDepsFor(api: ExtensionAPI, repoPath: string): CollectDeps {
  return {
    exec: (options) => api.shell.exec(options),
    cwd: repoPath,
    issues: sensorIssuesFor(api),
    now: () => new Date().toISOString(),
  }
}

/**
 * A signal store whose root is resolved on every call — the records location
 * follows the open workspace, the same reason `createLiveOrderStore` exists.
 */
function liveSignalStore(root: () => string): SignalStore {
  return {
    list: () => createSignalStore(root()).list(),
    save: (signals) => createSignalStore(root()).save(signals),
    get: (id) => createSignalStore(root()).get(id),
    sensorState: () => createSignalStore(root()).sensorState(),
    setSensorState: (id, patch) => createSignalStore(root()).setSensorState(id, patch),
  }
}

/**
 * Every due, enabled sensor, run once, sequentially — one interval tick,
 * whether it is the live 60-second one or a manual "run now".
 */
async function tickSensors(api: ExtensionAPI, root: string, store: SignalStore): Promise<void> {
  const sources = resolveSources(api, root)
  const defs = availableSensors(sources).map(({ def }) => def)
  const states = await store.sensorState()
  const now = new Date().toISOString()
  for (const def of dueSensors(defs, states, now)) {
    // `dueSensors` already refused anything without a repository; the null
    // check here is only so the type checker agrees.
    const repoPath = states[def.id].repoPath
    if (repoPath === null) continue
    try {
      await runSensor(def, {
        store,
        collectDeps: sensorCollectDepsFor(api, repoPath),
        now: () => new Date().toISOString(),
        newId: () => randomUUID(),
      })
    } catch (error) {
      api.log.error(`sensor ${def.id} failed to run`, error)
    }
  }
}

/**
 * Signals read the product back into the factory while the app is open. One
 * tick a minute, over whichever sensors are enabled and have a repository —
 * nothing runs while none are, which is the default. Resolved on every tick
 * rather than once, the same reason `dataRoot` is a function: the records
 * location, and which repository each sensor watches, both follow the
 * operator's own configuration.
 */
export function startSensorTick({ api, dataRoot }: ActivationContext): SignalStore {
  const signalStore = liveSignalStore(dataRoot)
  sensorTimer = setInterval(() => {
    void tickSensors(api, dataRoot(), signalStore)
  }, 60_000)
  return signalStore
}

export function stopSensorTick(): void {
  if (sensorTimer !== null) clearInterval(sensorTimer)
  sensorTimer = null
}
