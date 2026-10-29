import React, { lazy, Suspense } from 'react'
import { useExtensionRegistry } from '../extensions/registry'
import { NotificationPanel } from '../components/NotificationPanel'
import { AboutDialog } from '../components/AboutDialog'
import { NameTerminalDialog } from '../components/NameTerminalDialog'
import { LogWindow } from '../components/LogWindow'
import { ToastContainer } from '../components/ToastContainer'
import { HomeBadge, SessionLinkHost } from '../components/AppShellParts'
import { StartWorkHost } from '../components/home/StartWorkHost'
import { AddToTaskDialog } from '../components/tasks/AddToTaskDialog'
import { TaskSwitcher } from '../components/task-switcher/TaskSwitcher'
// Not lazy: the keys typed straight after ⌘P ("n n", "/") would reach the
// app before a lazily loaded panel mounted, and be lost.
import { QuickActionsHost, type QuickActionsHostProps } from '../components/QuickActionsHost'
import type { PendingTab } from './terminal-launch'
import { BreakoutWindows } from '../components/terminal/BreakoutWindowView'

// Opened on demand, so it is its own chunk rather than part of the first
// script (https://react.dev/reference/react/lazy).
const SettingsPanel = lazy(() =>
  import('../components/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
)

/** Each of the shell's dialogs and windows: open or not, and closing it. */
export interface ShellOverlayState {
  settingsOpen: boolean
  closeSettings: () => void
  aboutOpen: boolean
  closeAbout: () => void
  logOpen: boolean
  closeLog: () => void
  linkSessionId: string | null
  closeLink: () => void
  pendingTab: PendingTab | null
  confirmPendingTab: (title: string) => void
  cancelPendingTab: () => void
  /** The palette's props while it is open, else null. */
  quickActions: QuickActionsHostProps | null
}

/** What draws over the shell: dialogs, windows, the palette, toasts and extension overlays. */
export function ShellOverlays(state: ShellOverlayState): React.JSX.Element {
  return (
    <>
      <NotificationPanel />
      {state.settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={state.closeSettings} />
        </Suspense>
      )}
      {state.aboutOpen && <AboutDialog onClose={state.closeAbout} />}
      {state.pendingTab && (
        <NameTerminalDialog
          defaultName={state.pendingTab.defaultName}
          onConfirm={state.confirmPendingTab}
          onCancel={state.cancelPendingTab}
        />
      )}
      {state.logOpen && <LogWindow onClose={state.closeLog} />}
      {state.linkSessionId !== null && (
        <SessionLinkHost sessionId={state.linkSessionId} onClose={state.closeLink} />
      )}
      {state.quickActions && <QuickActionsHost {...state.quickActions} />}
      <WorkDialogs />
      <HomeBadge />
      <ToastContainer />
      <ExtensionOverlays />
      <BreakoutWindows />
    </>
  )
}

/** The dialogs that start work or add a branch to a task, closed until something opens them. */
function WorkDialogs(): React.JSX.Element {
  return (
    <>
      <StartWorkHost />
      <AddToTaskDialog />
      <TaskSwitcher />
    </>
  )
}

/** Whatever extensions draw over the whole window. */
function ExtensionOverlays(): React.JSX.Element {
  const overlays = useExtensionRegistry((s) => s.overlays)
  return (
    <>
      {overlays.map((Overlay, i) => (
        <Overlay key={i} />
      ))}
    </>
  )
}
