import type { ElectronAPI } from '../../src/shared/electron-api/api-type'
import { partialFake } from './fakes'

/**
 * What a spec gives `electronApiOf`: the namespaces it uses, each with only the
 * methods it calls, every one with its real signature.
 */
export type ElectronApiParts = {
  [Key in keyof ElectronAPI]?: ElectronAPI[Key] extends (...args: never[]) => unknown
    ? ElectronAPI[Key]
    : Partial<ElectronAPI[Key]>
}

/**
 * A `window.electronAPI` typed as the real one, holding only `parts`. A method
 * left out fails at run time, like any `partialFake`.
 */
export function electronApiOf(parts: ElectronApiParts): ElectronAPI {
  return partialFake<ElectronAPI>(parts as Partial<ElectronAPI>)
}

/** Installs `electronApiOf(parts)` as `window.electronAPI` and returns it. */
export function installElectronApi(parts: ElectronApiParts): ElectronAPI {
  const api = electronApiOf(parts)
  Object.defineProperty(window, 'electronAPI', { value: api, writable: true, configurable: true })
  return api
}

/**
 * One event the main process pushes (`terminal.onProcessExit`,
 * `extensionEvents.onMenuOpenSettings`, ...): `subscribe` stands in for the
 * `on…` method, and `emit` delivers to whoever subscribed, as main would.
 */
export function pushedEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>()
  return {
    subscribe: (listener: (...args: Args) => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (...args: Args): void => listeners.forEach((listener) => listener(...args)),
    get listening(): boolean {
      return listeners.size > 0
    },
  }
}

/** `extensionBridge.on` by channel, with `emit` to push one channel's payload. */
export function bridgeEvents() {
  const listeners = new Map<string, Set<(data: unknown) => void>>()
  return {
    on: (channel: string, listener: (data: unknown) => void): (() => void) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
      return () => {
        set.delete(listener)
      }
    },
    emit: (channel: string, data?: unknown): void =>
      listeners.get(channel)?.forEach((listener) => listener(data)),
  }
}
