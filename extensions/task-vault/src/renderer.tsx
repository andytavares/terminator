import React from 'react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { TaskVaultView, CaptureModal } from './components/TaskVaultView'
import { LinkedVaultPanel } from './components/LinkedVaultPanel'
import { useVaultStore } from './stores/vault.store'
import type { CommandRegistration } from '../../../src/renderer/extensions/registry'

function LinkedVaultPanelWrapper({
  repoRoot,
}: {
  repoRoot: string | null
  onClose: () => void
}): React.JSX.Element {
  if (!repoRoot) {
    return <div className="linked-vault-panel linked-vault-panel--empty">No active project.</div>
  }
  return <LinkedVaultPanel targetId={repoRoot} />
}

const registry = useExtensionRegistry.getState()

registry.registerGlobalTab({
  id: 'task-vault',
  label: 'Task Vault',
  icon: '✓',
  component: TaskVaultView,
  permanent: true,
})

registry.registerSidebarPanel({
  id: 'task-vault-links',
  label: 'Vault Links',
  component: LinkedVaultPanelWrapper,
  defaultOpen: false,
})

registry.registerOverlay(CaptureModal)

registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+R',
  description: 'Open Weekly Review',
  action: () => {
    useVaultStore.getState().setView('review')
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
  useVaultStore.getState().setShowCaptureModal(true)
}

const DEFAULT_CAPTURE_HOTKEY = 'CommandOrControl+Shift+T'

const captureCommand: CommandRegistration = {
  id: 'task-vault:capture-to-inbox',
  label: 'Task Vault: Capture to Inbox',
  description: 'Quick-capture a task to the vault inbox',
  shortcut: acceleratorToDisplay(DEFAULT_CAPTURE_HOTKEY),
  category: 'Task Vault',
  action: openInboxModal,
}
registry.registerCommand(captureCommand)

// Register in-app keyboard shortcut using the same captureHotkey setting
void (async () => {
  try {
    const { values } = await window.electronAPI.extensions.getSettingsValues()
    const accel =
      (values['terminator.task-vault.captureHotkey'] as string | undefined) ??
      DEFAULT_CAPTURE_HOTKEY
    registry.registerKeyboardShortcut({
      accelerator: accel,
      action: openInboxModal,
      description: 'Quick Add to Inbox',
    })
    registry.updateCommand('task-vault:capture-to-inbox', { shortcut: acceleratorToDisplay(accel) })
  } catch {
    registry.registerKeyboardShortcut({
      accelerator: DEFAULT_CAPTURE_HOTKEY,
      action: openInboxModal,
      description: 'Quick Add to Inbox',
    })
  }
})()

// Inbox badge — keep the task-vault rail icon count in sync
async function refreshInboxBadge(): Promise<void> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
    const items = (result as { tasks?: unknown[] } | null)?.tasks ?? []
    registry.updateGlobalTab('task-vault', { badge: items.length > 0 ? items.length : undefined })
  } catch {
    // Vault not configured — no badge
  }
}

void refreshInboxBadge()
window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
  void refreshInboxBadge()
})
window.electronAPI.extensionBridge.on('task-vault:push:open-capture', () => {
  openInboxModal()
})
