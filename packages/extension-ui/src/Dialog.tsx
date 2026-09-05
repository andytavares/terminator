import React, { createContext, useContext, useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { captureFocus, trapTab } from './focus-trap'
import { nestedLayerValue } from './layers'
import { createModalDepthRegistry } from './modal-depth'
import './extension-ui.css'

export interface DialogAction {
  /** Verb-first, sentence case. Says what happens: "Save brief", not "OK". */
  label: string
  onSelect: () => void | Promise<void>
  tone?: 'default' | 'primary' | 'danger'
  /** Display-only hint, e.g. "⌘↵". */
  shortcut?: string
}

export interface DialogProps {
  title: string
  children?: React.ReactNode
  /** One to three. At most one should carry the primary tone. */
  actions: DialogAction[]
  /**
   * When false, Escape and outside-click do not close. Reserved for a surface
   * holding unsaved work; the explicit close control still works, or the dialog
   * would be a trap.
   */
  dismissible?: boolean
  /** Called for Escape, outside click and the close control alike. */
  onDismiss: () => void
}

/**
 * The resolved stacking value of the surface a component sits inside, so a
 * dialog or picker opened from within one renders above it rather than behind.
 */
const LayerContext = createContext<number | null>(null)

export function useContainingLayer(): number | null {
  return useContext(LayerContext)
}

/**
 * One dialog, for the whole product.
 *
 * Everything a caller would otherwise have written by hand — Escape, focus
 * trapping and restoration, `role`, `aria-modal`, a scrim, outside-click, and
 * registering the modal depth the exit gesture reads — happens here. Measured
 * before this existed: of 19 hand-written surfaces, 6 closed on Escape, 5 set a
 * dialog role, 3 set aria-modal, 7 managed focus and 4 dismissed on an outside
 * click. No two agreed.
 *
 * It renders inside the caller's own React tree (ADR 038), which is what keeps
 * the content it was opened from visible and dimmed behind the scrim rather
 * than hidden.
 */
export function Dialog({
  title,
  children,
  actions,
  dismissible = true,
  onDismiss,
}: DialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const parentLayer = useContainingLayer()
  const zIndex = nestedLayerValue('modal', parentLayer ?? null)

  // Read through a ref so the listeners below never need re-binding when the
  // caller passes a fresh closure on every render.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useEffect(() => {
    const registry = createModalDepthRegistry(window as unknown as Record<string, unknown>)
    const release = registry.release()
    const restoreFocus = panelRef.current ? captureFocus(panelRef.current) : () => {}

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      // Only the innermost open surface answers Escape. Without this a nested
      // picker and the dialog containing it would both close on one press.
      if (!isInnermost(panelRef.current)) return
      if (!dismissibleRef.current) return
      e.stopPropagation()
      dismissRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocus()
      release()
    }
  }, [])

  return (
    <LayerContext.Provider value={zIndex}>
      <div
        className="tmui-dialog__scrim"
        style={{ zIndex }}
        onClick={() => {
          if (dismissibleRef.current) onDismiss()
        }}
      >
        <div
          ref={panelRef}
          data-tmui-panel=""
          className="tmui-dialog__panel"
          style={{ zIndex }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && panelRef.current && trapTab(panelRef.current, e.shiftKey)) {
              e.preventDefault()
            }
          }}
        >
          <div className="tmui-dialog__head">
            <h2 id={titleId} className="tmui-dialog__title">
              {title}
            </h2>
            <button
              type="button"
              className="tmui-icon-button tmui-dialog__close"
              data-tmui-close=""
              aria-label="Close"
              title="Close"
              onClick={onDismiss}
            >
              <X aria-hidden="true" />
            </button>
          </div>

          {children !== undefined && <div className="tmui-dialog__body">{children}</div>}

          <div className="tmui-dialog__actions">
            {actions.map((action) => (
              <DialogActionButton key={action.label} action={action} />
            ))}
          </div>
        </div>
      </div>
    </LayerContext.Provider>
  )
}

export function DialogActionButton({ action }: { action: DialogAction }): JSX.Element {
  return (
    <button
      type="button"
      className={`tmui-button tmui-button--${action.tone ?? 'default'}`}
      onClick={() => void action.onSelect()}
    >
      {action.label}
      {action.shortcut !== undefined && <kbd className="tmui-kbd">{action.shortcut}</kbd>}
    </button>
  )
}

/**
 * Whether this panel is the last one opened.
 *
 * Nested surfaces all listen on the document, so without this every one of them
 * would answer a single Escape and the whole stack would collapse at once.
 */
function isInnermost(panel: HTMLElement | null): boolean {
  if (!panel) return false
  // Dialogs and popovers share one ordering: whichever surface opened last owns
  // Escape, whatever kind it is.
  const surfaces = Array.from(document.querySelectorAll('[data-tmui-panel],[data-tmui-surface]'))
  return surfaces[surfaces.length - 1] === panel
}
