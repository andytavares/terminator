import { useEffect } from 'react'
import {
  createDoubleEscapeDetector,
  escapeContextFromTarget,
  shouldSuppressExitGesture,
} from '../../shared/double-escape'
import { useExtensionRegistry } from '../extensions/registry'
import { useModalStore } from '../stores/modal.store'
import { focusActiveTerminal } from '../lib/focus-terminal'

/**
 * Wires the double-Escape gesture that leaves an extension and returns the user
 * to their terminal.
 *
 * Two sources feed the same exit, because an extension panel is a separate
 * webContents (ADR-022) and its keystrokes never reach this window:
 *  - keydown here, for when an extension surface is showing but focus sits in
 *    the host chrome;
 *  - `extension:exit-to-terminal`, relayed by main when the gesture fires
 *    inside the extension's own view.
 */
export function useExtensionEscapeExit(): void {
  useEffect(() => {
    function exit(sidebarPanelId?: string): void {
      const exited = useExtensionRegistry.getState().exitExtensionToTerminal(sidebarPanelId)
      // Deferred so TerminalPane has mounted before it is handed focus.
      if (exited) setTimeout(focusActiveTerminal, 0)
    }

    const detector = createDoubleEscapeDetector()

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return

      // Escape belongs to the shell inside a terminal, and to the field being
      // edited inside an input. A core modal owns it too — those close on a
      // single Escape and must not also throw the user out of an extension.
      //
      // The rule itself lives in shared/double-escape so the copy running
      // inside every extension view applies exactly the same one. Two
      // implementations is how they came to disagree, and the extension side
      // was the one that lost people's drafts.
      const context = escapeContextFromTarget(e.target, useModalStore.getState().depth)
      if (shouldSuppressExitGesture(context)) {
        detector.reset()
        return
      }

      if (detector.register(performance.now())) exit()
    }

    window.addEventListener('keydown', handleKeyDown)
    const unsubscribe = window.electronAPI?.extensionEvents?.onExtensionExitToTerminal?.(
      ({ sidebarPanelId }) => exit(sidebarPanelId ?? undefined)
    )

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      unsubscribe?.()
    }
  }, [])
}
