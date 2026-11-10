import { isValidElement } from 'react'
import { SquareArrowOutUpRight, type LucideIcon } from 'lucide-react'
import { useExtensionRegistry } from '../../extensions/registry'
import { openInExtension } from './desk-actions'
import type { WorkThread } from '../../home/work-threads'

export interface OpenInApp {
  label: string
  icon: LucideIcon
  open: () => void
}

/** The extension's name as its workspace tab shows it; undefined when it has no tab. */
function extensionName(source: string): string | undefined {
  return useExtensionRegistry.getState().workspaceTabs.get(source)?.label
}

/** "Open in Foundry": the name of the action that shows the extension's own view. */
export function openInAppLabel(source: string): string {
  return `Open in ${extensionName(source) ?? 'app'}`
}

/** `iconFromName` draws a lucide component, so the tab's icon element carries it as its type. */
function iconOf(source: string): LucideIcon {
  const icon = useExtensionRegistry.getState().workspaceTabs.get(source)?.icon
  return isValidElement(icon) ? (icon.type as LucideIcon) : SquareArrowOutUpRight
}

/** "Open in app": shows the extension view that owns the thread; null when none does. */
export function useOpenInApp(thread: WorkThread): OpenInApp | null {
  const { opensIn } = thread
  useExtensionRegistry((s) => s.workspaceTabs)
  if (opensIn === null) return null
  return {
    label: openInAppLabel(opensIn.source),
    icon: iconOf(opensIn.source),
    open: () => void openInExtension(opensIn.source, opensIn),
  }
}
