// Discover extension renderer entry points at build time via Vite glob (lazy),
// then load only the renderers whose extensions are active in the main process.
// The core app never references any specific extension by name.

const renderers = import.meta.glob('../../../extensions/*/src/renderer.tsx')

export async function initExtensions(): Promise<void> {
  const result = await window.electronAPI.extension.list()
  const activeIds = new Set(
    result.extensions.filter((e) => e.status === 'enabled').map((e) => e.id)
  )

  for (const [path, load] of Object.entries(renderers)) {
    const match = path.match(/extensions\/([^/]+)\/src\/renderer\.tsx/)
    if (!match) continue
    const dirName = match[1]
    // Convention: the last dot-segment of an extension ID matches its directory name.
    // e.g. "terminator.git-integration" → "git-integration"
    const isActive = [...activeIds].some((id) => id === dirName || id.split('.').pop() === dirName)
    if (isActive) await load()
  }
}
