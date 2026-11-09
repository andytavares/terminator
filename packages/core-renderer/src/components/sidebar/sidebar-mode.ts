import { useSettingsStore } from '../../stores/settings.store'
import type { SidebarMode } from '../../../../core-shared/src/schemas/settings.schema'

/** Which sidebar the operator chose: the repo tree or the Inbox. */
export function useSidebarMode(): SidebarMode {
  return useSettingsStore((s) => s.globalSettings?.ui?.sidebarMode ?? 'tree')
}

/** Switches between the tree and the Inbox, and saves the choice. */
export function toggleSidebarMode(): void {
  const settings = useSettingsStore.getState()
  const mode = settings.globalSettings?.ui?.sidebarMode ?? 'tree'
  void settings.updateSidebarMode(mode === 'inbox' ? 'tree' : 'inbox')
}
