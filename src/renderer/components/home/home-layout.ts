import { useSettingsStore } from '../../stores/settings.store'
import type { HomeLayout } from '../../../shared/schemas/settings.schema'

/** Which body Home draws: the Desk as it was, or the queue above the task list. */
export function useHomeLayout(): HomeLayout {
  return useSettingsStore((s) => s.globalSettings?.ui?.homeLayout ?? 'tasks')
}
