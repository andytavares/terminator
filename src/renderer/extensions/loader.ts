import React from 'react'
import type { ComponentType } from 'react'
import { useExtensionRegistry } from './registry'
import { ExtensionPanelPortal } from '../components/ExtensionPanelPortal'
import { iconFromName } from './icon-from-name'
import type { Extension } from '../../shared/types/index'
import { allocateExtensionGroups } from '../quick-actions/groups'
import { makeRendererLogger } from '../logger'

const log = makeRendererLogger('quick-actions')

function makePortalComponent(
  ext: Extension,
  viewParam: string
): ComponentType<{ repoRoot?: string | null }> {
  return function ExtensionPortalComponent({ repoRoot }: { repoRoot?: string | null } = {}) {
    return React.createElement(ExtensionPanelPortal, {
      extensionId: ext.id,
      viewParam,
      isActive: true,
      repoRoot,
      rendererUrl: ext.rendererUrl,
    })
  }
}

type Registry = ReturnType<typeof useExtensionRegistry.getState>
type Contributes = NonNullable<Extension['contributes']>

/** The global and workspace tabs, which show the extension in place of the terminal. */
function registerFullTabs(ext: Extension, contributes: Contributes, registry: Registry): void {
  const { globalTab, workspaceTab } = contributes
  if (globalTab) {
    const viewParam = globalTab.view ?? 'main'
    registry.registerGlobalTab({
      id: ext.id,
      label: globalTab.label,
      icon: globalTab.icon ? iconFromName(globalTab.icon) : undefined,
      component: makePortalComponent(ext, viewParam) as ComponentType<Record<string, never>>,
      sortOrder: 1,
      view: viewParam,
    })
  }
  if (workspaceTab) {
    const viewParam = workspaceTab.view ?? 'workspace'
    registry.registerWorkspaceTab({
      id: ext.id,
      label: workspaceTab.label,
      icon: workspaceTab.icon ? iconFromName(workspaceTab.icon) : undefined,
      component: makePortalComponent(ext, viewParam),
      view: viewParam,
    })
  }
}

/** The project tab, which shows the extension in place of a branch's terminal. */
function registerContributedProjectTab(
  ext: Extension,
  contributes: Contributes,
  registry: Registry
): void {
  const { projectTab } = contributes
  if (!projectTab) return
  const viewParam = projectTab.view ?? 'project'
  registry.registerProjectTab({
    id: ext.id,
    label: projectTab.label,
    component: makePortalComponent(ext, viewParam) as ComponentType<{
      repoRoot: string | null
    }>,
    view: viewParam,
  })
}

/** The sidebar panel, which shows beside the terminal. */
function registerContributedSidebarPanel(
  ext: Extension,
  contributes: Contributes,
  registry: Registry
): void {
  const { sidebarPanel } = contributes
  if (!sidebarPanel) return
  const viewParam = sidebarPanel.view ?? 'sidebar'
  registry.registerSidebarPanel({
    id: ext.id,
    label: sidebarPanel.label,
    defaultOpen: sidebarPanel.defaultOpen,
    view: viewParam,
    component: makePortalComponent(ext, viewParam) as ComponentType<{
      repoRoot: string | null
      onClose: () => void
    }>,
  })
}

/** Window views, and the shortcuts that toggle the extension's sidebar panel. */
function registerWindowsAndShortcuts(
  ext: Extension,
  contributes: Contributes,
  registry: Registry
): void {
  for (const { id: viewId, view } of contributes.windowViews ?? []) {
    registry.registerWindowView(
      viewId,
      makePortalComponent(ext, view) as ComponentType<{ repoRoot: string | null }>
    )
  }
  if (!contributes.sidebarPanel) return
  for (const cmd of contributes.commands ?? []) {
    if (!cmd.shortcut) continue
    registry.registerKeyboardShortcut({
      accelerator: cmd.shortcut,
      action: () => useExtensionRegistry.getState().togglePanel(ext.id),
      description: cmd.description,
    })
  }
}

/** @internal */
export function registerWebviewExtension(ext: Extension, registry: Registry): void {
  if (!ext.contributes) return
  registerFullTabs(ext, ext.contributes, registry)
  registerContributedProjectTab(ext, ext.contributes, registry)
  registerContributedSidebarPanel(ext, ext.contributes, registry)
  registerWindowsAndShortcuts(ext, ext.contributes, registry)
}

export async function initExtensions(): Promise<void> {
  const result = await window.electronAPI.extension.list()
  const activeExtensions = result.extensions.filter((e) => e.status === 'enabled')
  const registry = useExtensionRegistry.getState()

  for (const ext of activeExtensions) {
    registerWebviewExtension(ext, registry)
  }

  const { groups, warnings } = allocateExtensionGroups(
    activeExtensions
      .filter((ext) => ext.contributes?.quickActions?.group)
      .map((ext) => ({
        extensionId: ext.id,
        mnemonic: ext.contributes!.quickActions!.group!.mnemonic,
        label: ext.contributes!.quickActions!.group!.label,
      }))
  )
  registry.setQuickActionGroups(groups)
  for (const warning of warnings) log.warn(warning)
}
