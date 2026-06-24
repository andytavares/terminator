// Discover extension renderer entry points at build time via Vite glob (lazy),
// then load only the renderers whose extensions are active in the main process.
// The core app never references any specific extension by name.

import { useExtensionRegistry } from './registry'

const bundledRenderers = import.meta.glob('../../../extensions/*/src/renderer.tsx')

// Expose the renderer-side registry as a global so externally-installed extensions
// (loaded at runtime, not bundled by Vite) can register their UI contributions.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__terminatorRegistry = useExtensionRegistry
}

export async function initExtensions({
  renderers = bundledRenderers,
  dynamicLoader = (url: string) => import(/* @vite-ignore */ url) as Promise<unknown>,
}: {
  renderers?: Record<string, () => Promise<unknown>>
  dynamicLoader?: (url: string) => Promise<unknown>
} = {}): Promise<void> {
  const result = await window.electronAPI.extension.list()
  const activeExtensions = result.extensions.filter((e) => e.status === 'enabled')
  const activeIds = new Set(activeExtensions.map((e) => e.id))

  const loadedIds = new Set<string>()
  for (const [path, load] of Object.entries(renderers)) {
    const match = path.match(/extensions\/([^/]+)\/src\/renderer\.tsx/)
    if (!match) continue
    const dirName = match[1]
    // Convention: the last dot-segment of an extension ID matches its directory name.
    // e.g. "terminator.git-integration" → "git-integration"
    const matchedId = [...activeIds].find((id) => id === dirName || id.split('.').pop() === dirName)
    if (matchedId) {
      await load()
      loadedIds.add(matchedId)
    }
  }

  // Load externally-installed extension renderers that were not covered by the
  // build-time glob. These ship a pre-built renderer.js declared in their manifest
  // and are served via the ext:// custom protocol registered in the main process.
  for (const ext of activeExtensions) {
    if (loadedIds.has(ext.id) || !ext.rendererUrl) continue
    await dynamicLoader(ext.rendererUrl)
  }
}
