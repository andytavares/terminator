import { useExtensionRegistry } from '../../core-renderer/src/extensions/registry'
import { useSessionStore } from '../../core-renderer/src/stores/session.store'
import { useWorkspaceStore } from '../../core-renderer/src/stores/workspace.store'

/** The real session store's state now. */
export const sessionState = () => useSessionStore.getState()

/** The real workspace store's state now. */
export const workspaceState = () => useWorkspaceStore.getState()

/** The real extension registry's state now. */
export const registryState = () => useExtensionRegistry.getState()
