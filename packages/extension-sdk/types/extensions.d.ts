/**
 * The APIs built-in extensions return from `activate` (ADR 094). A consumer
 * lists the provider in its manifest's `extensionDependencies` and reads the
 * object with `api.extensions.get(id)`, which is typed from
 * `BuiltInExtensionExports`. The provider implements the same declaration.
 */

/** Where `TaskVaultAPI.open` takes the operator. Every field is optional. */
export interface VaultDestination {
  /** A day in the daily log, `YYYY-MM-DD`. */
  date?: string
  taskId?: string
  /** Which of the vault's views to land on; absent keeps the current one. */
  view?: 'daily' | 'review'
}

/** `terminator.task-vault`'s exports. */
export interface TaskVaultAPI {
  /** Brings the window forward and opens the vault at `destination`. */
  open(destination?: VaultDestination): void
  /** Opens the vault's quick-capture overlay for a new inbox task. */
  openCapture(): void
}

/** Each built-in extension's id and the type of its exports. */
export interface BuiltInExtensionExports {
  'terminator.task-vault': TaskVaultAPI
}
