import { useCallback, useState } from 'react'
import { useExtensionRegistry } from '../extensions/registry'
import { useSettingsStore } from '../stores/settings.store'

const HOME_TAB_ID = 'core.home'

/** The operator's own sidebar toggle, except on Home with `ui.hideSidebarOnHome` on:
 * there the tree is hidden and ⌘B reveals it for that visit only. */
export function useSidebarVisibility(): { sidebarVisible: boolean; toggleSidebar: () => void } {
  const [userVisible, setUserVisible] = useState(true)
  const [revealedOnHome, setRevealedOnHome] = useState(false)
  const onHome = useExtensionRegistry((s) => s.activeGlobalTabId === HOME_TAB_ID)
  const hideOnHome = useSettingsStore((s) => s.globalSettings?.ui?.hideSidebarOnHome ?? true)
  const hiddenByHome = onHome && hideOnHome

  // Leaving Home ends the visit, so the reveal does not carry into the next one.
  const [wasOnHome, setWasOnHome] = useState(onHome)
  if (wasOnHome !== onHome) {
    setWasOnHome(onHome)
    if (!onHome) setRevealedOnHome(false)
  }

  const toggleSidebar = useCallback(() => {
    if (hiddenByHome) setRevealedOnHome((revealed) => !revealed)
    else setUserVisible((visible) => !visible)
  }, [hiddenByHome])

  return { sidebarVisible: hiddenByHome ? revealedOnHome : userVisible, toggleSidebar }
}
