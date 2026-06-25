import React from 'react'
import type { ComponentType } from 'react'
import { useExtensionRegistry } from './registry'
import { ExtensionPanelPortal } from '../components/ExtensionPanelPortal'
import { iconFromName } from './icon-from-name'
import type { Extension } from '../../shared/types/index'

function makePortalComponent(
  extensionId: string,
  viewParam: string
): ComponentType<Record<string, never>> {
  return function ExtensionPortalComponent() {
    return React.createElement(ExtensionPanelPortal, { extensionId, viewParam, isActive: true })
  }
}

export function registerWebviewExtension(
  ext: Extension,
  registry: ReturnType<typeof useExtensionRegistry.getState>
): void {
  if (!ext.contributes) return
  const { globalTab, workspaceTab, projectTab, sidebarPanel, windowViews } = ext.contributes

  if (globalTab) {
    const viewParam = globalTab.view ?? 'main'
    registry.registerGlobalTab({
      id: ext.id,
      label: globalTab.label,
      icon: globalTab.icon ? iconFromName(globalTab.icon) : undefined,
      component: makePortalComponent(ext.id, viewParam),
      sortOrder: 1,
    })
  }

  if (workspaceTab) {
    const viewParam = workspaceTab.view ?? 'workspace'
    registry.registerWorkspaceTab({
      id: ext.id,
      label: workspaceTab.label,
      icon: workspaceTab.icon ? iconFromName(workspaceTab.icon) : undefined,
      component: makePortalComponent(ext.id, viewParam),
    })
  }

  if (projectTab) {
    const viewParam = projectTab.view ?? 'project'
    registry.registerProjectTab({
      id: ext.id,
      label: projectTab.label,
      component: makePortalComponent(ext.id, viewParam) as ComponentType<{
        repoRoot: string | null
      }>,
    })
  }

  if (sidebarPanel) {
    const viewParam = sidebarPanel.view ?? 'sidebar'
    registry.registerSidebarPanel({
      id: ext.id,
      label: sidebarPanel.label,
      defaultOpen: sidebarPanel.defaultOpen,
      component: makePortalComponent(ext.id, viewParam) as ComponentType<{
        repoRoot: string | null
        onClose: () => void
      }>,
    })
  }

  for (const { id: viewId, view } of windowViews ?? []) {
    registry.registerWindowView(
      viewId,
      makePortalComponent(ext.id, view) as ComponentType<{ repoRoot: string | null }>
    )
  }

  for (const cmd of ext.contributes.commands ?? []) {
    if (!cmd.shortcut) continue
    if (sidebarPanel) {
      registry.registerKeyboardShortcut({
        accelerator: cmd.shortcut,
        action: () => useExtensionRegistry.getState().togglePanel(ext.id),
        description: cmd.description,
      })
    }
  }
}

export async function initExtensions(): Promise<void> {
  const result = await window.electronAPI.extension.list()
  const activeExtensions = result.extensions.filter((e) => e.status === 'enabled')
  const registry = useExtensionRegistry.getState()

  for (const ext of activeExtensions) {
    registerWebviewExtension(ext, registry)
  }
}
