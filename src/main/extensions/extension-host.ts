import { join } from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import type { Extension } from '../../shared/types/index.js'
import { ExtensionManifestSchema } from '../../shared/schemas/extension.schema.js'
import { createExtensionAPI, globalRegistry, type Disposable } from './api.js'

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

  async load(
    directoryPath: string
  ): Promise<
    | { extension: Extension }
    | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }
  > {
    let manifest: Record<string, unknown>
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      manifest = require(join(directoryPath, 'extension.json'))
    } catch (e) {
      return { error: 'INVALID_MANIFEST', message: 'Cannot read extension.json' }
    }

    const parsed = ExtensionManifestSchema.safeParse(manifest)
    if (!parsed.success) {
      return { error: 'INVALID_MANIFEST', message: parsed.error.message }
    }

    const { id, name, version, description, main } = parsed.data
    const existing = store.get('extensions').find((e) => e.id === id)
    if (existing) return { error: 'DUPLICATE_ID' }

    const appVersion = app.getVersion()
    if (!isVersionCompatible(parsed.data.minAppVersion, appVersion)) {
      return {
        error: 'VERSION_INCOMPATIBLE',
        message: `Requires app >= ${parsed.data.minAppVersion}, got ${appVersion}`,
      }
    }

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
      const errorRecord: ExtensionRecord = {
        ...record,
        status: 'error',
        errorMessage: loadResult.message,
      }
      store.set('extensions', [...store.get('extensions'), errorRecord])
      const { directoryPath: _dp, ...ext } = errorRecord
      return { extension: ext }
    }

    store.set('extensions', [...store.get('extensions'), record])
    const { directoryPath: _dp, ...ext } = record
    return { extension: ext }
  }

  async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id)
    if (loaded) {
      try {
        await loaded.module.deactivate?.()
      } catch {
        // Ignore deactivate errors
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

  listExtensions(): Extension[] {
    return store.get('extensions').map(({ directoryPath: _dp, ...ext }) => ext)
  }

  async loadAll(): Promise<void> {
    const extensions = store.get('extensions').filter((e) => e.status === 'enabled')
    for (const record of extensions) {
      await this.activate(record)
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
      const api = createExtensionAPI(record.id, app.getVersion())
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
