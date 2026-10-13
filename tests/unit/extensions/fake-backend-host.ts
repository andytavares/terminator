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
