import React from 'react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { TaskVaultView } from './components/TaskVaultView'
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

registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+R',
  description: 'Open Weekly Review',
  action: () => {
    useVaultStore.getState().setView('review')
  },
})

const captureCommand: CommandRegistration = {
  id: 'task-vault:capture-to-inbox',
  label: 'Task Vault: Capture to Inbox',
  description: 'Quick-capture a task to the vault inbox',
  category: 'Task Vault',
  action: () => {
    registry.setActiveGlobalTab('task-vault')
    useVaultStore.getState().setShowCaptureModal(true)
  },
}
registry.registerCommand(captureCommand)
