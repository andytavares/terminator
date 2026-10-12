import { createRequire } from 'node:module'
import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { app } from 'electron'
import { CachedStore } from '../storage/cached-store.js'
import type { z } from 'zod'
import type { Extension } from '../../shared/types/index.js'
import { ExtensionManifestSchema } from '../../shared/schemas/extension.schema.js'
import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import { createExtensionAPI, getApiDisposables, type ExtensionAPIDeps } from './api.js'
import { makeLogger } from '../logger.js'

// Extension bundles and manifests are CommonJS; main is an ES module.
const loadCommonJs = createRequire(import.meta.url)

const hostLogger = makeLogger('extension-host')

interface ExtensionRecord extends Extension {
  directoryPath: string
  rendererRelPath?: string
}

interface ExtensionStoreSchema {
  extensions: ExtensionRecord[]
}

const store = new CachedStore<ExtensionStoreSchema>({
  name: 'extensions',
  defaults: { extensions: [] },
})

interface LoadedExtension {
  record: ExtensionRecord
  disposables: Disposable[]
  module: { activate?: unknown; deactivate?: () => void | Promise<void> }
  /** What `activate` returned: the API this extension offers its dependants (ADR 094). */
  exports: unknown
}

interface StartOptions {
  bundledDirectory: string
  /** Work extensions need before activating, such as the login-shell PATH. */
  beforeActivation: Promise<void>
  /** Work that needs every extension's tables to exist, such as the legacy database import. */
  afterActivation?: () => Promise<void>
}

type RegisterResult =
  | { record: ExtensionRecord }
  | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }

type ParsedManifest = z.infer<typeof ExtensionManifestSchema>

function readManifest(
  directoryPath: string
): { data: ParsedManifest } | { error: 'INVALID_MANIFEST'; message: string } {
  let manifest: Record<string, unknown>
  try {
    manifest = loadCommonJs(join(directoryPath, 'manifest.json'))
  } catch {
    hostLogger.warn(`INVALID_MANIFEST: cannot read manifest.json at ${directoryPath}`)
    return { error: 'INVALID_MANIFEST', message: 'Cannot read manifest.json' }
  }
  const parsed = ExtensionManifestSchema.safeParse(manifest)
  if (parsed.success) return { data: parsed.data }
  hostLogger.warn(`INVALID_MANIFEST: ${parsed.error.message}`)
  return { error: 'INVALID_MANIFEST', message: parsed.error.message }
}

function toRecord(manifest: ParsedManifest, directoryPath: string): ExtensionRecord {
  const { id, name, version, description, main, renderer, contributes } = manifest
  return {
    id,
    name,
    version,
    description,
    entryPoint: join(directoryPath, main),
    status: 'enabled',
    installedAt: new Date().toISOString(),
    directoryPath,
    rendererRelPath: renderer,
    rendererUrl: renderer ? `ext://${id}/${renderer}` : undefined,
    contributes,
  }
}

/**
 * Read from the manifest, not the stored record: a bundled extension stays
 * registered across updates, so its record can predate the field.
 */
function declaredDependencies(record: ExtensionRecord): string[] {
  const manifest = readManifest(record.directoryPath)
  return 'data' in manifest ? (manifest.data.extensionDependencies ?? []) : []
}

/** Where backends run: the extension host (ADR 094). */
export interface BackendHost {
  activate(record: { id: string; entryPoint: string; dependencies: string[] }): Promise<void>
  deactivate(extensionId: string): Promise<void>
}

/** The dependency path from `id` back to itself, or null when `id` is in no cycle. */
function cycleThrough(id: string, dependenciesOf: (id: string) => string[]): string[] | null {
  const visit = (path: string[]): string[] | null => {
    for (const dependency of dependenciesOf(path[path.length - 1])) {
      if (dependency === id) return [...path, dependency]
      if (path.includes(dependency)) continue
      const cycle = visit([...path, dependency])
      if (cycle) return cycle
    }
    return null
  }
  return visit([id])
}

function toExtension(record: ExtensionRecord): Extension {
  const { directoryPath: _dp, ...extension } = record
  return extension
}

export class ExtensionHost {
  private loaded = new Map<string, LoadedExtension>()
  private activations = new Map<string, Promise<void>>()
  private afterActivation: Promise<void> = Promise.resolve()
  private deps: ExtensionAPIDeps = {}
  private backendHost: BackendHost | null = null
  /** The main-side API of each backend in the extension host, which its calls run on. */
  private readonly hostedApis = new Map<string, ExtensionAPI>()
  private readonly hostFailures = new Map<string, string>()

  setDeps(deps: ExtensionAPIDeps): void {
    this.deps = deps
  }

  /** Runs every backend in `host`. Without one (unit tests), backends load in this process. */
  useBackendHost(host: BackendHost): void {
    this.backendHost = host
  }

  /** The API a backend in the extension host calls into, while it is active. */
  hostedApi(extensionId: string): ExtensionAPI | undefined {
    return this.hostedApis.get(extensionId)
  }

  /**
   * The extension host lost these backends for good: they show as failed, with
   * why, until they activate again. Not stored, so the next launch retries them.
   */
  failHostedBackends(extensionIds: string[], message: string): void {
    for (const id of extensionIds) {
      const loaded = this.loaded.get(id)
      if (!loaded) continue
      this.disposeAll(loaded.disposables)
      this.loaded.delete(id)
      this.hostedApis.delete(id)
      this.hostFailures.set(id, message)
      hostLogger.error(`Extension ${id} failed: ${message}`)
    }
  }

  async load(
    directoryPath: string
  ): Promise<
    | { extension: Extension }
    | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }
  > {
    const registration = this.register(directoryPath)
    if ('error' in registration) return registration

    const { record } = registration
    const loadResult = await this.activate(record)
    if ('error' in loadResult) {
      hostLogger.error(`Extension ${record.id} activation failed: ${loadResult.message}`)
      return { extension: toExtension(this.recordActivationFailure(record, loadResult.message)) }
    }

    hostLogger.info(`Extension ${record.id} loaded successfully`)
    return { extension: toExtension(record) }
  }

  /** Validates the manifest and persists the extension as enabled; does not activate it. */
  private register(directoryPath: string): RegisterResult {
    const manifest = readManifest(directoryPath)
    if ('error' in manifest) return manifest

    const { id, version } = manifest.data
    if (store.get('extensions').some((e) => e.id === id)) {
      hostLogger.warn(`DUPLICATE_ID: extension ${id} is already registered`)
      return { error: 'DUPLICATE_ID' }
    }

    const appVersion = app.getVersion()
    if (!isVersionCompatible(manifest.data.minAppVersion, appVersion)) {
      const message = `Requires app >= ${manifest.data.minAppVersion}, got ${appVersion}`
      hostLogger.warn(`VERSION_INCOMPATIBLE: ${id} ${message}`)
      return { error: 'VERSION_INCOMPATIBLE', message }
    }

    hostLogger.info(`Loading extension ${id} v${version} from ${directoryPath}`)
    const record = toRecord(manifest.data, directoryPath)
    store.set('extensions', [...store.get('extensions'), record])
    return { record }
  }

  private recordActivationFailure(record: ExtensionRecord, message: string): ExtensionRecord {
    const failed: ExtensionRecord = { ...record, status: 'error', errorMessage: message }
    store.set(
      'extensions',
      store.get('extensions').map((e) => (e.id === record.id ? failed : e))
    )
    return failed
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
      this.disposeAll(loaded.disposables)
      this.loaded.delete(id)
      this.hostedApis.delete(id)
    }
  }

  private disposeAll(disposables: Disposable[]): void {
    for (const d of disposables) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
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
    return store.get('extensions').map(({ directoryPath: _dp, rendererRelPath: _rrp, ...ext }) => {
      const failure = this.hostFailures.get(ext.id)
      return failure === undefined
        ? ext
        : { ...ext, status: 'error' as const, errorMessage: failure }
    })
  }

  getExtensionContributes(id: string) {
    const record = store.get('extensions').find((e) => e.id === id)
    return record?.contributes ?? null
  }

  getExtensionDirectory(id: string): string | null {
    const record = store.get('extensions').find((e) => e.id === id)
    return record?.directoryPath ?? null
  }

  /**
   * Registers every extension, so `listExtensions` is complete when this call
   * returns its promise, then activates them all at once after
   * `beforeActivation`. One extension failing never stops another: `activate`
   * reports failure as a value. Views wait on `whenActivated`.
   */
  async start(options: StartOptions): Promise<void> {
    const registered = [
      ...store
        .get('extensions')
        .filter((e) => e.status === 'enabled')
        .map((record) => ({ record, isNew: false })),
      ...this.registerBundled(options.bundledDirectory).map((record) => ({ record, isNew: true })),
    ]
    const dependencies = new Map(
      registered.map(({ record }) => [record.id, declaredDependencies(record)])
    )
    const dependenciesOf = (id: string) => dependencies.get(id) ?? []
    for (const { record, isNew } of registered) {
      const cycle = cycleThrough(record.id, dependenciesOf)
      const activation = cycle
        ? this.failAtStartup(record, isNew, `Extension dependency cycle: ${cycle.join(' -> ')}`)
        : this.activateAtStartup(record, isNew, options.beforeActivation)
      this.activations.set(record.id, activation)
    }
    const allActivated = Promise.all(this.activations.values())
    if (options.afterActivation) this.afterActivation = allActivated.then(options.afterActivation)
    await Promise.all([allActivated, this.afterActivation])
  }

  /** Resolves once the extension's backend is up and any startup data import is done. */
  async whenActivated(id: string): Promise<void> {
    await this.activations.get(id)
    await this.afterActivation
  }

  private registerBundled(bundledDir: string): ExtensionRecord[] {
    if (!existsSync(bundledDir)) return []
    let names: string[]
    try {
      names = readdirSync(bundledDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }
    const records: ExtensionRecord[] = []
    for (const name of names) {
      const directoryPath = join(bundledDir, name)
      if (!existsSync(join(directoryPath, 'manifest.json'))) continue
      // Already in the store (activated from there, or failed on an earlier run):
      // registering again would only log DUPLICATE_ID.
      if (this.isStored(directoryPath)) continue
      const registration = this.register(directoryPath)
      if ('record' in registration) records.push(registration.record)
    }
    return records
  }

  private isStored(directoryPath: string): boolean {
    try {
      const { id } = loadCommonJs(join(directoryPath, 'manifest.json')) as { id?: string }
      return store.get('extensions').some((e) => e.id === id)
    } catch {
      return false // register() reports the unreadable manifest
    }
  }

  private async activateAtStartup(
    record: ExtensionRecord,
    isNew: boolean,
    beforeActivation: Promise<void>
  ): Promise<void> {
    await beforeActivation
    // Every activation is in the map by now: start() fills it before anything awaits.
    await Promise.all(declaredDependencies(record).map((id) => this.activations.get(id)))
    const result = await this.activate(record)
    if ('error' in result) await this.failAtStartup(record, isNew, result.message)
  }

  private async failAtStartup(record: ExtensionRecord, isNew: boolean, message: string) {
    hostLogger.error(`Extension ${record.id} failed to load: ${message}`)
    // A stored extension stays enabled so the next start retries it.
    if (isNew) this.recordActivationFailure(record, message)
  }

  /** Why a declared dependency is not active, or null when every one is. */
  private inactiveDependency(record: ExtensionRecord): string | null {
    for (const id of declaredDependencies(record)) {
      if (this.loaded.has(id)) continue
      const stored = store.get('extensions').find((e) => e.id === id)
      if (!stored) return `Missing extension dependency "${id}"`
      if (stored.status === 'disabled') return `Extension dependency "${id}" is disabled`
      return `Extension dependency "${id}" failed to activate`
    }
    return null
  }

  /** The exports of `dependencyId`, for an extension that declared it. */
  private exportsFor(record: ExtensionRecord, dependencyId: string): unknown {
    if (!declaredDependencies(record).includes(dependencyId)) {
      throw new Error(
        `Extension "${record.id}" did not declare "${dependencyId}" in extensionDependencies`
      )
    }
    if (this.hostedApis.has(dependencyId)) {
      throw new Error(`Extension "${dependencyId}" runs in the extension host; its API is not here`)
    }
    return this.loaded.get(dependencyId)?.exports
  }

  private async activate(
    record: ExtensionRecord
  ): Promise<{ ok: true } | { error: string; message: string }> {
    const inactive = this.inactiveDependency(record)
    if (inactive) return { error: 'DEPENDENCY_ERROR', message: inactive }
    if (this.backendHost) {
      return this.activateInHost(record, this.backendHost)
    }
    try {
      const mod = loadCommonJs(record.entryPoint) as {
        activate?: (api: unknown) => unknown
        deactivate?: () => void | Promise<void>
      }
      const deps: ExtensionAPIDeps = {
        ...this.deps,
        extensionExports: (dependencyId) => this.exportsFor(record, dependencyId),
      }
      const api = createExtensionAPI(record.id, app.getVersion(), deps, record.rendererUrl)
      const exports = await mod.activate?.(api)
      // The live array from the api: registrations made after activate() land in
      // it too, so unload disposes everything the extension ever registered.
      const disposables = getApiDisposables(api)
      this.loaded.set(record.id, { record, disposables, module: mod, exports })
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { error: 'ACTIVATE_ERROR', message }
    }
  }

  private async activateInHost(
    record: ExtensionRecord,
    host: BackendHost
  ): Promise<{ ok: true } | { error: string; message: string }> {
    const api = createExtensionAPI(record.id, app.getVersion(), this.deps, record.rendererUrl)
    this.hostedApis.set(record.id, api)
    try {
      const dependencies = declaredDependencies(record)
      await host.activate({ id: record.id, entryPoint: record.entryPoint, dependencies })
    } catch (e) {
      this.hostedApis.delete(record.id)
      this.disposeAll(getApiDisposables(api))
      return { error: 'ACTIVATE_ERROR', message: e instanceof Error ? e.message : String(e) }
    }
    this.hostFailures.delete(record.id)
    const deactivate = () => host.deactivate(record.id)
    const disposables = getApiDisposables(api)
    this.loaded.set(record.id, { record, disposables, module: { deactivate }, exports: undefined })
    return { ok: true }
  }
}

export function isVersionCompatible(minVersion: string, appVersion: string): boolean {
  const cleanMin = minVersion.replace(/^[>=^~]+/, '')
  const min = cleanMin.split('.').map(Number)
  const cur = appVersion.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false
  }
  return true
}
