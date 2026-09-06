// The typed bridge, reduced to what still exists.
//
// This file once declared 53 channels for a board that is gone. The Foundry
// surfaces call the bridge directly with their own response types, so what is
// left here is the model picker — the one place a shared shim still earns its
// keep, because the list and the current choice must not drift apart.

export interface ModelChoiceView {
  /** What goes on the `--model` command line. Empty means: pass nothing. */
  readonly id: string
  readonly label: string
  /** True for an alias, which never goes stale the way a pinned id does. */
  readonly floating: boolean
}

export interface FoundryBridge {
  modelsList(): Promise<{ models: ModelChoiceView[]; selected: string }>
  modelSet(payload: { model: string }): Promise<{ ok: true } | { error: string }>
}

declare global {
  interface Window {
    electronAPI: {
      extensionBridge: {
        invoke(channel: string, payload?: unknown): Promise<unknown>
        on(channel: string, handler: (data: unknown) => void): () => void
      }
      workspace: { list(): Promise<unknown> }
      project: { create(input: unknown): Promise<unknown> }
    }
  }
}

export function getFoundryAPI(): FoundryBridge {
  const bridge = window.electronAPI.extensionBridge
  return {
    modelsList: () =>
      bridge.invoke('foundry:models-list', {}) as Promise<{
        models: ModelChoiceView[]
        selected: string
      }>,
    modelSet: (payload) =>
      bridge.invoke('foundry:model-set', payload) as Promise<{ ok: true } | { error: string }>,
  }
}
