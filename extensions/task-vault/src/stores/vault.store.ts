/**
 * Facade store that composes VaultDataStore, VaultNavStore, and VaultFilterStore
 * into a single unified hook, preserving backward compatibility with all consumers.
 */
import { useVaultDataStore } from './vault-data.store'
import { useVaultNavStore } from './vault-nav.store'
import { useVaultFilterStore } from './vault-filter.store'

export type { VaultView } from './vault-nav.store'
export type { ViewMode } from './vault-filter.store'

export function useVaultStore() {
  return {
    ...useVaultDataStore(),
    ...useVaultNavStore(),
    ...useVaultFilterStore(),
  }
}
