import { join } from 'path'
import type { BackendHost } from '../../../src/main/extensions/extension-host'
import type { BackendRecord } from '../../../src/main/extensions/host/host-runtime'

/** What a backend does when the extension host activates it; throwing fails the activation. */
export type FakeBackend = (record: BackendRecord) => void | Promise<void>

/** The extension host process as ExtensionHost drives it (ADR 094), without a
 * process: each backend is a function given by extension id. */
export class FakeBackendHost implements BackendHost {
  /** Every activation that succeeded, in the order each finished. */
  readonly activated: BackendRecord[] = []
  readonly deactivated: string[] = []

  constructor(private readonly backends: Record<string, FakeBackend> = {}) {}

  async activate(record: BackendRecord): Promise<void> {
    await this.backends[record.id]?.(record)
    this.activated.push(record)
  }

  async deactivate(extensionId: string): Promise<void> {
    this.deactivated.push(extensionId)
  }
}

/** An extension record as an earlier run stored it, for an extension directory under `root`. */
export function storedExtensionRecord(root: string, id: string, status: 'enabled' | 'disabled') {
  const directoryPath = join(root, id)
  return {
    id,
    name: id,
    version: '1.0.0',
    description: '',
    entryPoint: join(directoryPath, 'main.js'),
    status,
    installedAt: new Date().toISOString(),
    directoryPath,
  }
}

/** A real ExtensionHost over a FakeBackendHost, imported after the spec's `vi.resetModules()`. */
export async function newExtensionHost(backends: Record<string, FakeBackend> = {}) {
  const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
  const backendHost = new FakeBackendHost(backends)
  return { host: new ExtensionHost(backendHost), backendHost }
}
