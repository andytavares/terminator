import React from 'react'
import { Check, X } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { TaskVaultView, CaptureModal } from './components/TaskVaultView'
import { CalendarDrawer } from './components/CalendarDrawer'
import { useVaultNavStore } from './stores/vault-nav.store'
import { useVaultDataStore } from './stores/vault-data.store'
import { DEFAULT_CAPTURE_HOTKEY } from './constants'
import type { CommandRegistration } from '../../../src/renderer/extensions/registry'

function VaultCalendarPanel({
  onClose,
}: {
  repoRoot: string | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="vault-cal-panel">
      <div className="vault-cal-panel__header">
        <span className="vault-cal-panel__title">Calendar</span>
        <button className="vault-cal-panel__close" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>
      <CalendarDrawer />
    </div>
  )
}

const registry = useExtensionRegistry.getState()

registry.registerGlobalTab({
  id: 'task-vault',
  label: 'Task Vault',
  icon: React.createElement(Check),
  component: TaskVaultView,
  permanent: true,
})

registry.registerSidebarPanel({
  id: 'task-vault-links',
  label: 'Vault Calendar',
  component: VaultCalendarPanel,
  defaultOpen: false,
})

registry.registerOverlay(CaptureModal)

registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+R',
  description: 'Open Weekly Review',
  action: () => {
    useVaultNavStore.getState().setView('review')
  },
})

function acceleratorToDisplay(accel: string): string {
  return accel
    .replace(/CommandOrControl/g, '⌘')
    .replace(/CmdOrCtrl/g, '⌘')
    .replace(/Command/g, '⌘')
    .replace(/Ctrl/g, '⌃')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '')
}

function openInboxModal() {
  useVaultNavStore.getState().setShowCaptureModal(true)
}

const captureCommand: CommandRegistration = {
  id: 'task-vault:capture-to-inbox',
  label: 'Task Vault: Capture to Inbox',
  description: 'Quick-capture a task to the vault inbox',
  shortcut: acceleratorToDisplay(DEFAULT_CAPTURE_HOTKEY),
  category: 'Task Vault',
  action: openInboxModal,
}
registry.registerCommand(captureCommand)

registry.registerKeyboardShortcut({
  accelerator: DEFAULT_CAPTURE_HOTKEY,
  action: openInboxModal,
  description: 'Quick Add to Inbox',
})

// Inbox badge — keep the task-vault rail icon count in sync.
// Updates both the store (inboxCount) and the registry badge so all sources stay consistent.
async function refreshInboxBadge(): Promise<void> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
    const items = (result as { tasks?: unknown[] } | null)?.tasks ?? []
    const count = items.length
    // Updating the store triggers the subscribe() below, which updates the registry badge.
    useVaultDataStore.setState({ inboxCount: count })
  } catch {
    // Vault not configured — no badge
  }
}

// Sync badge whenever inboxCount changes in the store (e.g. after quick-add via CaptureModal)
useVaultDataStore.subscribe((state, prevState) => {
  if (state.inboxCount !== prevState.inboxCount) {
    const count = state.inboxCount
    registry.updateGlobalTab('task-vault', { badge: count > 0 ? count : undefined })
  }
})

void refreshInboxBadge()
window.electronAPI.extensionBridge.on('task-vault:navigate-task', (payload) => {
  registry.setActiveGlobalTabWithNavigation('task-vault', payload)
})
window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
  void refreshInboxBadge()
})
window.electronAPI.extensionBridge.on('task-vault:push:open-capture', () => {
  openInboxModal()
})
