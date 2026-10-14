import { useExtensionRegistry } from '../../src/renderer/extensions/registry'
import { useSessionStore } from '../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

/** The real session store's state now. */
export const sessionState = () => useSessionStore.getState()

/** The real workspace store's state now. */
export const workspaceState = () => useWorkspaceStore.getState()

/** The real extension registry's state now. */
export const registryState = () => useExtensionRegistry.getState()
