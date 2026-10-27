import { join } from 'path'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { app } from 'electron'
import { CachedStore } from '../storage/cached-store.js'
import type { z } from 'zod'
import type { Extension } from '../../shared/types/index.js'
import { ExtensionManifestSchema } from '../../shared/schemas/extension.schema.js'
import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import { createExtensionAPI, getApiDisposables, type ExtensionAPIDeps } from './api.js'
import { makeLogger } from '../logger.js'
import type { BackendRecord } from './host/host-runtime.js'

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

interface StartOptions {
  bundledDirectory: string
  /** Work extensions need before activating, such as the login-shell PATH. */
  beforeActivation: Promise<void>
}

type RegisterResult =
  | { record: ExtensionRecord }
  | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }

type ParsedManifest = z.infer<typeof ExtensionManifestSchema>

/** Read from disk every time: require() would cache it, and a pulled manifest would never show. */
function readManifestJson(directoryPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directoryPath, 'manifest.json'), 'utf8'))
}

function readManifest(
  directoryPath: string
): { data: ParsedManifest } | { error: 'INVALID_MANIFEST'; message: string } {
  let manifest: Record<string, unknown>
  try {
    manifest = readManifestJson(directoryPath)
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

/** The stored record with what its manifest declares now. A bundled extension stays registered
 * across updates, so the record can predate a field; an unreadable manifest keeps the record. */
function withCurrentManifest(record: ExtensionRecord): ExtensionRecord {
  const manifest = readManifest(record.directoryPath)
  if ('error' in manifest) return record
  const { status, installedAt, errorMessage } = record
  return { ...toRecord(manifest.data, record.directoryPath), status, installedAt, errorMessage }
}

/** Read from the manifest, not the stored record: a bundled extension stays registered across
 * updates, so its record can predate the field. */
function declaredDependencies(record: ExtensionRecord): string[] {
  const manifest = readManifest(record.directoryPath)
  return 'data' in manifest ? (manifest.data.extensionDependencies ?? []) : []
}

/** The manifest's `contributes.shellRoots`, read like `extensionDependencies` (ADR 102). */
function declaredShellRoots(record: ExtensionRecord): string[] {
  const manifest = readManifest(record.directoryPath)
  return 'data' in manifest ? (manifest.data.contributes?.shellRoots ?? []) : []
}

/** Where backends run: the extension host (ADR 094). */
export interface BackendHost {
  activate(record: BackendRecord): Promise<void>
  deactivate(extensionId: string): Promise<void>
}

/** The dependency path from `id` back to itself, or null when `id` is in no cycle. */
function cycleThrough(id: string, dependenciesOf: (id: string) => string[]): string[] | null {
  const extendPath = (path: string[]): string[] | null => {
    for (const dependency of dependenciesOf(path[path.length - 1])) {
      if (dependency === id) return [...path, dependency]
      if (path.includes(dependency)) continue
      const cycle = extendPath([...path, dependency])
      if (cycle) return cycle
    }
    return null
  }
  return extendPath([id])
}

function toExtension(record: ExtensionRecord): Extension {
  const { directoryPath: _dp, ...extension } = record
  return extension
}

export class ExtensionHost {
  /** Each active backend's registrations in main, by extension id. */
  private loaded = new Map<string, Disposable[]>()
  private activations = new Map<string, Promise<void>>()
  private deps: ExtensionAPIDeps = {}
  /** The main-side API of each backend in the extension host, which its calls run on. */
  private readonly hostedApis = new Map<string, ExtensionAPI>()
  private readonly hostFailures = new Map<string, string>()

  /** Every backend runs in `backends`, the extension host process (ADR 094). */
  constructor(private readonly backends: BackendHost) {}

  setDeps(deps: ExtensionAPIDeps): void {
    this.deps = deps
  }

  /** The API a backend in the extension host calls into, while it is active. */
  apiOf(extensionId: string): ExtensionAPI | undefined {
    return this.hostedApis.get(extensionId)
  }

  /** The extension host lost these backends for good: they show as failed, with why, until they
   * activate again. Not stored, so the next launch retries them. */
  failHostedBackends(extensionIds: string[], message: string): void {
    const lost = extensionIds.flatMap((id) => {
      const loaded = this.loaded.get(id)
      return loaded ? [{ id, loaded }] : []
    })
    for (const { id, loaded } of lost) {
      this.disposeAll(loaded)
      this.loaded.delete(id)
      this.hostedApis.delete(id)
      this.hostFailures.set(id, message)
      hostLogger.error(`Extension ${id} failed: ${message}`)
    }
    if (lost.length > 0) this.announceListChanged()
  }

  /** Tells the windows `listExtensions` changed: Settings -> Extensions re-reads it, since a
   * backend can fail or come back while the panel is open. */
  private announceListChanged(): void {
    this.deps.broadcastToWindows?.('extension:list-changed', null)
  }

  private saveRecords(records: ExtensionRecord[]): void {
    store.set('extensions', records)
    this.announceListChanged()
  }

  async load(
    directoryPath: string
  ): Promise<
    | { extension: Extension }
    | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE'; message?: string }
  > {
    const registration = this.registerDirectory(directoryPath)
    if ('error' in registration) return registration

    const { record } = registration
    const loadResult = await this.activateBackend(record)
    if ('error' in loadResult) {
      hostLogger.error(`Extension ${record.id} activation failed: ${loadResult.message}`)
      return { extension: toExtension(this.recordActivationFailure(record, loadResult.message)) }
    }

    hostLogger.info(`Extension ${record.id} loaded successfully`)
    return { extension: toExtension(record) }
  }

  /** Validates the manifest and persists the extension as enabled; does not activate it. */
  private registerDirectory(directoryPath: string): RegisterResult {
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
    this.saveRecords([...store.get('extensions'), record])
    return { record }
  }

  private recordActivationFailure(record: ExtensionRecord, message: string): ExtensionRecord {
    const failed: ExtensionRecord = { ...record, status: 'error', errorMessage: message }
    this.saveRecords(store.get('extensions').map((e) => (e.id === record.id ? failed : e)))
    return failed
  }

  async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id)
    if (loaded) {
      hostLogger.info(`Unloading extension ${id}`)
      try {
        await this.backends.deactivate(id)
      } catch (e) {
        hostLogger.warn(
          `Extension ${id} deactivate error: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      this.disposeAll(loaded)
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

  async uninstallExtension(id: string): Promise<boolean> {
    await this.unload(id)
    const extensions = store.get('extensions')
    const filtered = extensions.filter((e) => e.id !== id)
    if (filtered.length === extensions.length) return false
    this.saveRecords(filtered)
    return true
  }

  async reloadExtension(id: string): Promise<{ extension: Extension } | { error: string }> {
    const extensions = store.get('extensions')
    const record = extensions.find((e) => e.id === id)
    if (!record) return { error: 'NOT_FOUND' }

    await this.unload(id)
    const result = await this.activateBackend(record)
    if ('error' in result) return { error: result.message }

    const { directoryPath: _dp, ...ext } = record
    return { extension: ext }
  }

  async setEnabled(id: string, enabled: boolean): Promise<Extension | null> {
    const extensions = store.get('extensions')
    const idx = extensions.findIndex((e) => e.id === id)
    if (idx === -1) return null

    if (!enabled) {
      await this.unload(id)
      extensions[idx] = { ...extensions[idx], status: 'disabled' }
    } else {
      const record = extensions[idx]
      await this.activateBackend(record)
      extensions[idx] = { ...extensions[idx], status: 'enabled' }
    }

    this.saveRecords(extensions)
    const { directoryPath: _dp, ...ext } = extensions[idx]
    return ext
  }

  async unloadAll(): Promise<void> {
    for (const id of [...this.loaded.keys()]) {
      await this.unload(id)
    }
  }

  listAll(): Extension[] {
    return store.get('extensions').map(({ directoryPath: _dp, rendererRelPath: _rrp, ...ext }) => {
      const failure = this.hostFailures.get(ext.id)
      return failure === undefined
        ? ext
        : { ...ext, status: 'error' as const, errorMessage: failure }
    })
  }

  getExtensionContributes(id: string): Extension['contributes'] | null {
    const record = store.get('extensions').find((e) => e.id === id)
    return record?.contributes ?? null
  }

  getExtensionDirectory(id: string): string | null {
    const record = store.get('extensions').find((e) => e.id === id)
    return record?.directoryPath ?? null
  }

  /** Registers every extension, so `listAll` is complete when this call returns its
   * promise, then activates them all at once after `beforeActivation`. One extension failing
   * never stops another: `activate` reports failure as a value. Views wait on `whenActivated`. */
  async startAll(options: StartOptions): Promise<void> {
    store.set('extensions', store.get('extensions').map(withCurrentManifest))
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
    await Promise.all(this.activations.values())
  }

  /** Resolves once the extension's backend is up. */
  async whenActivated(id: string): Promise<void> {
    await this.activations.get(id)
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
      const registration = this.registerDirectory(directoryPath)
      if ('record' in registration) records.push(registration.record)
    }
    return records
  }

  private isStored(directoryPath: string): boolean {
    try {
      const { id } = readManifestJson(directoryPath) as { id?: string }
      return store.get('extensions').some((e) => e.id === id)
    } catch {
      return false // registerDirectory() reports the unreadable manifest
    }
  }

  private async activateAtStartup(
    record: ExtensionRecord,
    isNew: boolean,
    beforeActivation: Promise<void>
  ): Promise<void> {
    await beforeActivation
    // Every activation is in the map by now: startAll() fills it before anything awaits.
    await Promise.all(declaredDependencies(record).map((id) => this.activations.get(id)))
    const result = await this.activateBackend(record)
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

  private async activateBackend(
    record: ExtensionRecord
  ): Promise<{ ok: true } | { error: string; message: string }> {
    const inactive = this.inactiveDependency(record)
    if (inactive) return { error: 'DEPENDENCY_ERROR', message: inactive }
    const deps = { ...this.deps, shellRootSettings: declaredShellRoots(record) }
    const api = createExtensionAPI(record.id, deps, record.rendererUrl)
    this.hostedApis.set(record.id, api)
    try {
      const dependencies = declaredDependencies(record)
      const { id, entryPoint, directoryPath: directory } = record
      await this.backends.activate({ id, entryPoint, directory, dependencies })
    } catch (e) {
      this.hostedApis.delete(record.id)
      this.disposeAll(getApiDisposables(api))
      return { error: 'ACTIVATE_ERROR', message: e instanceof Error ? e.message : String(e) }
    }
    // Every launch, not only an extension's first: scripts/smoke-start.mjs reads it.
    hostLogger.info(`Extension ${record.id} activated`)
    if (this.hostFailures.delete(record.id)) this.announceListChanged()
    // The live array from the api: registrations made after activate() land in
    // it too, so unload disposes everything the backend ever registered.
    this.loaded.set(record.id, getApiDisposables(api))
    return { ok: true }
  }
}

/** @internal */
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
