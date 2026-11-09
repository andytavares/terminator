import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'

/** A backend's module, as the extension host requires it. */
export interface BackendModule {
  activate?: (api: ExtensionAPI) => unknown
  deactivate?: () => void | Promise<void>
}

/** Where a backend's code is: its entry point and its extension's directory. */
export interface BackendFiles {
  entryPoint: string
  directory: string
}

/** How the extension host gets a backend's module, and lets go of it. */
export interface BackendLoader {
  load(entryPoint: string): BackendModule
  /** Drops the backend's modules, so the next `load` reads them from disk again. */
  forget(files: BackendFiles): void
}

/** A loader over `load`, a CommonJS require. Its `require.cache` is keyed by each module's
 * resolved (real) path, and a module deleted from it is evaluated again on its next require:
 * https://nodejs.org/api/modules.html#requirecache */
export function requireLoader(load: NodeJS.Require): BackendLoader {
  return {
    load: (entryPoint) => load(entryPoint) as BackendModule,
    forget: ({ entryPoint, directory }) => {
      const entry = resolvedPath(entryPoint)
      const root = resolvedPath(directory)
      for (const path of Object.keys(load.cache)) {
        if (path === entry || isInside(root, path)) delete load.cache[path]
      }
    },
  }
}

/** The path the require cache keys a module by: symlinks resolved, when it still exists. */
function resolvedPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : path
}

function isInside(directory: string, path: string): boolean {
  const rel = relative(directory, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
