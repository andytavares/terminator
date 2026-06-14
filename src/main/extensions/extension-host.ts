import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { app } from 'electron'
import Store from 'electron-store'
import type { Extension } from '../../shared/types/index.js'
import { ExtensionManifestSchema } from '../../shared/schemas/extension.schema.js'
import {
  createExtensionAPI,
  globalRegistry,
  type Disposable,
  type ExtensionAPIDeps,
} from './api.js'
import { makeLogger } from '../logger.js'

const hostLogger = makeLogger('extension-host')

interface ExtensionRecord extends Extension {
  directoryPath: string
}

interface ExtensionStoreSchema {
  extensions: ExtensionRecord[]
}

const store = new Store<ExtensionStoreSchema>({
  name: 'extensions',
  defaults: { extensions: [] },
})

interface LoadedExtension {
  record: ExtensionRecord
  disposables: Disposable[]
  module: { activate?: unknown; deactivate?: () => void | Promise<void> }
}

export class ExtensionHost {
  private loaded = new Map<string, LoadedExtension>()
  private deps: ExtensionAPIDeps = {}

  setDeps(deps: ExtensionAPIDeps): void {
    this.deps = deps
  }

  async load(
    directoryPath: string
  ): Promise<
    | { extension: Extension }
    | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }
  > {
    let manifest: Record<string, unknown>
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      manifest = require(join(directoryPath, 'manifest.json'))
    } catch (e) {
      hostLogger.warn(`INVALID_MANIFEST: cannot read manifest.json at ${directoryPath}`)
      return { error: 'INVALID_MANIFEST', message: 'Cannot read manifest.json' }
    }

    const parsed = ExtensionManifestSchema.safeParse(manifest)
    if (!parsed.success) {
      hostLogger.warn(`INVALID_MANIFEST: ${parsed.error.message}`)
      return { error: 'INVALID_MANIFEST', message: parsed.error.message }
    }

    const { id, name, version, description, main } = parsed.data
    const existing = store.get('extensions').find((e) => e.id === id)
    if (existing) {
      hostLogger.warn(`DUPLICATE_ID: extension ${id} is already registered`)
      return { error: 'DUPLICATE_ID' }
    }

    const appVersion = app.getVersion()
    if (!isVersionCompatible(parsed.data.minAppVersion, appVersion)) {
      hostLogger.warn(
        `VERSION_INCOMPATIBLE: ${id} requires >= ${parsed.data.minAppVersion}, got ${appVersion}`
      )
      return {
        error: 'VERSION_INCOMPATIBLE',
        message: `Requires app >= ${parsed.data.minAppVersion}, got ${appVersion}`,
      }
    }

    hostLogger.info(`Loading extension ${id} v${version} from ${directoryPath}`)
    const entryPoint = join(directoryPath, main)
    const record: ExtensionRecord = {
      id,
      name,
      version,
      description,
      entryPoint,
      status: 'enabled',
      installedAt: new Date().toISOString(),
      directoryPath,
    }

    const loadResult = await this.activate(record)
    if ('error' in loadResult) {
      hostLogger.error(`Extension ${id} activation failed: ${loadResult.message}`)
      const errorRecord: ExtensionRecord = {
        ...record,
        status: 'error',
        errorMessage: loadResult.message,
      }
      store.set('extensions', [...store.get('extensions'), errorRecord])
      const { directoryPath: _dp, ...ext } = errorRecord
      return { extension: ext }
    }

    hostLogger.info(`Extension ${id} loaded successfully`)
    store.set('extensions', [...store.get('extensions'), record])
    const { directoryPath: _dp, ...ext } = record
    return { extension: ext }
  }

  async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id)
    if (loaded) {
      hostLogger.info(`Unloading extension ${id}`)
      try {
        await loaded.module.deactivate?.()
      } catch (e) {
        hostLogger.warn(
          `Extension ${id} deactivate error: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      for (const d of loaded.disposables) {
        try {
          d.dispose()
        } catch {
          /* ignore */
        }
      }
      this.loaded.delete(id)
    }
  }

  async uninstall(id: string): Promise<boolean> {
    await this.unload(id)
    const extensions = store.get('extensions')
    const filtered = extensions.filter((e) => e.id !== id)
    if (filtered.length === extensions.length) return false
    store.set('extensions', filtered)
    return true
  }

  async reload(id: string): Promise<{ extension: Extension } | { error: string }> {
    const extensions = store.get('extensions')
    const record = extensions.find((e) => e.id === id)
    if (!record) return { error: 'NOT_FOUND' }

    await this.unload(id)

    // Clear Node module cache so the updated code is re-evaluated
    try {
      delete require.cache[require.resolve(record.entryPoint)]
    } catch {
      // Module may not be in cache (e.g. was never successfully loaded); safe to skip
    }

    const result = await this.activate(record)
    if ('error' in result) return { error: result.message }

    const { directoryPath: _dp, ...ext } = record
    return { extension: ext }
  }

  async toggle(id: string, enabled: boolean): Promise<Extension | null> {
    const extensions = store.get('extensions')
    const idx = extensions.findIndex((e) => e.id === id)
    if (idx === -1) return null

    if (!enabled) {
      await this.unload(id)
      extensions[idx] = { ...extensions[idx], status: 'disabled' }
    } else {
      const record = extensions[idx]
      await this.activate(record)
      extensions[idx] = { ...extensions[idx], status: 'enabled' }
    }

    store.set('extensions', extensions)
    const { directoryPath: _dp, ...ext } = extensions[idx]
    return ext
  }

  async unloadAll(): Promise<void> {
    for (const id of [...this.loaded.keys()]) {
      await this.unload(id)
    }
  }

  listExtensions(): Extension[] {
    return store.get('extensions').map(({ directoryPath: _dp, ...ext }) => ext)
  }

  async loadAll(): Promise<void> {
    const extensions = store.get('extensions').filter((e) => e.status === 'enabled')
    for (const record of extensions) {
      const result = await this.activate(record)
      if ('error' in result) {
        hostLogger.error(`Extension ${record.id} failed to load: ${result.message}`)
      }
    }
  }

  async loadBundledExtensions(bundledDir: string): Promise<void> {
    if (!existsSync(bundledDir)) return
    let entries: string[]
    try {
      entries = readdirSync(bundledDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return
    }
    for (const name of entries) {
      const dirPath = join(bundledDir, name)
      const manifestPath = join(dirPath, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      // Peek at manifest to get the real extension ID (e.g. "terminator.git-integration")
      // before checking this.loaded — directory name and ID differ.
      let extensionId: string | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const manifest = require(manifestPath) as { id?: string }
        extensionId = manifest.id
      } catch {
        // fall through and let load() report the invalid manifest
      }
      if (extensionId && this.loaded.has(extensionId)) continue
      await this.load(dirPath)
    }
  }

  private async activate(
    record: ExtensionRecord
  ): Promise<{ ok: true } | { error: string; message: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(record.entryPoint) as {
        activate?: (api: unknown) => void | Promise<void>
        deactivate?: () => void | Promise<void>
      }
      const api = createExtensionAPI(record.id, app.getVersion(), this.deps)
      await mod.activate?.(api)
      this.loaded.set(record.id, { record, disposables: [], module: mod })
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'ACTIVATE_ERROR', message }
    }
  }
}

function isVersionCompatible(minVersion: string, appVersion: string): boolean {
  const cleanMin = minVersion.replace(/^[>=^~]/, '')
  const min = cleanMin.split('.').map(Number)
  const cur = appVersion.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false
  }
  return true
}

export { globalRegistry }
