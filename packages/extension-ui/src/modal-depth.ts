/**
 * How many modal surfaces are open, counted per document.
 *
 * The count never crosses the *process* boundary. A dialog renders inside the
 * calling view (ADR 038) and the detector that must yield to it runs in that
 * same view, so no IPC is involved: sending it over IPC would make a
 * synchronous keypress decision depend on an asynchronous round trip, and a
 * dialog opening and closing faster than the message travels would leave the
 * count wrong and silently disable the exit gesture.
 *
 * It does cross the *context* boundary, which is a different thing — see below.
 *
 * The counter is published on the host object under a well-known key, and also
 * mirrored across the context bridge. Extension views run with
 * `contextIsolation: true`, so the preload's `window` is a different object from
 * the page's — the preload cannot read what the page writes, and the value has
 * to be handed over explicitly through the bridge the preload already exposes.
 */

export const MODAL_DEPTH_KEY = '__terminatorModalDepth'

export interface ModalDepthRegistry {
  /** Register an opened surface. */
  push(): void
  /** Release a closed surface. Never falls below zero. */
  pop(): void
  /** How many surfaces are currently open. */
  current(): number
  /**
   * Register an opened surface and return its release function. The release is
   * idempotent, so a component that unmounts twice — or whose cleanup runs
   * after an error boundary already tore it down — cannot leak the count.
   */
  release(): () => void
}

type Host = Record<string, unknown>

/** The slice of the bridge this module uses, so nothing else has to be stubbed. */
interface DepthBridge {
  setModalDepth?: (depth: number) => void
}

function bridgeOf(host: Host): DepthBridge | null {
  const api = host.electronAPI as { ui?: DepthBridge } | undefined
  return api?.ui ?? null
}

function read(host: Host): number {
  const raw = host[MODAL_DEPTH_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * All registries over one host share its count, so a dialog opened by the core
 * app and one opened by an extension in the same document are counted together.
 */
export function createModalDepthRegistry(host: Host): ModalDepthRegistry {
  function write(next: number): void {
    const depth = Math.max(0, next)
    host[MODAL_DEPTH_KEY] = depth
    // Mirror across the bridge for the preload's Escape detector, which lives in
    // the isolated world and cannot see the key above. Absent in tests and in
    // the core renderer, where the detector reads the same document.
    try {
      bridgeOf(host)?.setModalDepth?.(depth)
    } catch {
      // A bridge that rejects the call must never take a dialog down with it.
    }
  }

  const registry: ModalDepthRegistry = {
    push: () => write(read(host) + 1),
    pop: () => write(read(host) - 1),
    current: () => read(host),
    release() {
      registry.push()
      let released = false
      return () => {
        if (released) return
        released = true
        registry.pop()
      }
    },
  }

  return registry
}

/**
 * Read the count from a host that may never have registered anything.
 *
 * A preload script loads before any dialog has mounted, so an absent or
 * nonsense value means "nothing is open" rather than an error.
 */
export function getModalDepth(host: Host | undefined | null): number {
  if (!host) return 0
  return read(host)
}
