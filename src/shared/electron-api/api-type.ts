import type { ELECTRON_API_MANIFEST, ExtensionViewBehavior, Signature } from './manifest'

// The window.electronAPI type, derived from the manifest's specs: a spec with
// path 'terminal.close' and signature S becomes `terminal: { close: S }`, and a
// path without a dot becomes a top-level method.

type ManifestSpec = (typeof ELECTRON_API_MANIFEST)[number]

type MethodOf<Spec> = Spec extends { signature: Signature<infer Method> } ? Method : never

type ExtensionViewOf<Spec> = Spec extends { extensionView?: infer View }
  ? Extract<View, ExtensionViewBehavior>
  : never

type OnAppRenderer<Spec> = Spec extends unknown
  ? 'only' extends ExtensionViewOf<Spec>
    ? never
    : Spec
  : never

type NamespaceOf<Path> = Path extends `${infer Namespace}.${string}` ? Namespace : never

type BridgeOf<Spec extends { path: string }> = {
  [Namespace in NamespaceOf<Spec['path']>]: {
    [Member in Spec as Member['path'] extends `${Namespace}.${infer Name}`
      ? Name
      : never]: MethodOf<Member>
  }
} & {
  [Member in Spec as Member['path'] extends `${string}.${string}`
    ? never
    : Member['path']]: MethodOf<Member>
}

/** window.electronAPI in the app renderer, native and remote. */
export type ElectronAPI = BridgeOf<OnAppRenderer<ManifestSpec>>
