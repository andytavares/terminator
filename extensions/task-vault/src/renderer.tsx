import React from 'react'
import type { ExtensionRendererAPI } from '../../../src/renderer/extensions/registry'
import { TaskVaultView } from './components/TaskVaultView'
import { LinkedVaultPanel } from './components/LinkedVaultPanel'
import { useVaultStore } from './stores/vault.store'

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

export function activate(registry: ExtensionRendererAPI): void {
  registry.registerGlobalTab({
    id: 'task-vault',
    label: 'Task Vault',
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
}
