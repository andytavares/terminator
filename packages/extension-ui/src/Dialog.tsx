import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { captureFocus, trapTab } from './focus-trap'
import { nestedLayerValue } from './layers'
import { createModalDepthRegistry } from './modal-depth'
import './extension-ui.css'

export interface DialogAction {
  /** Verb-first, sentence case. Says what happens: "Save brief", not "OK". */
  label: string
  onSelect: () => void | Promise<void>
  tone?: 'default' | 'primary' | 'danger'
  /**
   * Unavailable, and visibly so.
   *
   * Without this a caller has to guard inside `onSelect`, which leaves a button
   * that looks pressable and does nothing — the exact confusion the audit found
   * in the git panel's commit controls.
   */
  disabled?: boolean
  /** Display-only hint, e.g. "⌘↵". */
  shortcut?: string
  /**
   * The dialog's form submission: Enter in a field runs it, as in any form.
   * At most one action submits; the panel becomes a `<form>` when one does.
   */
  submit?: boolean
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
  /**
   * How wide the panel is.
   *
   * A caller that needs more room asks for it here rather than sizing its own
   * content wider than the panel — which produced a dialog whose title and
   * close button scrolled off sideways.
   */
  size?: 'default' | 'wide'
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
export function Dialog(props: DialogProps): JSX.Element {
  const { dismissible = true, onDismiss } = props
  const panelRef = useRef<HTMLElement>(null)
  const zIndex = nestedLayerValue('modal', useContainingLayer() ?? null)
  const dismissibleRef = useModalBehaviour(panelRef, { onDismiss, dismissible })

  return (
    <LayerContext.Provider value={zIndex}>
      <div
        className="tmui-dialog__scrim"
        style={{ zIndex }}
        onClick={() => {
          if (dismissibleRef.current) onDismiss()
        }}
      >
        <DialogPanel {...props} panelRef={panelRef} zIndex={zIndex} />
      </div>
    </LayerContext.Provider>
  )
}

/**
 * Escape, focus moved in and restored to the opener, and the modal depth.
 * Returns the latest `dismissible`, which the scrim's click reads.
 */
function useModalBehaviour(
  panelRef: React.RefObject<HTMLElement>,
  { onDismiss, dismissible }: Pick<DialogProps, 'onDismiss'> & { dismissible: boolean }
): React.MutableRefObject<boolean> {
  // Read during the first render: by the time effects run, a field inside that
  // uses autoFocus already holds focus and the real opener is lost.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  // Read through a ref so the listeners below never need re-binding when the
  // caller passes a fresh closure on every render.
  const dismissRef = useRef(onDismiss)
  const dismissibleRef = useRef(dismissible)
  useEffect(() => {
    dismissRef.current = onDismiss
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    const release = createModalDepthRegistry(window).release()
    const restoreFocus = panelRef.current ? captureFocus(panelRef.current, opener) : () => {}
    const onKeyDown = (e: KeyboardEvent): void => {
      // Only the innermost open surface answers Escape. Without this a nested
      // picker and the dialog containing it would both close on one press.
      if (e.key !== 'Escape' || !isInnermost(panelRef.current) || !dismissibleRef.current) return
      e.stopPropagation()
      dismissRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocus()
      release()
    }
  }, [opener, panelRef])
  return dismissibleRef
}

interface DialogPanelProps extends DialogProps {
  panelRef: React.RefObject<HTMLElement>
  zIndex: number
}

/** The panel itself: a `<form>` when one action submits, so Enter in a field runs it. */
function DialogPanel({
  panelRef,
  zIndex,
  size = 'default',
  ...content
}: DialogPanelProps): JSX.Element {
  const titleId = useId()
  const submitting = content.actions.find((action) => action.submit === true)
  const Panel = submitting ? 'form' : 'div'
  return (
    <Panel
      ref={panelRef as React.RefObject<HTMLFormElement & HTMLDivElement>}
      data-tmui-panel=""
      className="tmui-dialog__panel"
      data-size={size}
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      {...panelEvents(submitting)}
    >
      <DialogContent {...content} titleId={titleId} />
    </Panel>
  )
}

/** Clicks stay inside, Enter submits through the submitting action, Tab cycles within. */
function panelEvents(submitting: DialogAction | undefined) {
  return {
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onSubmit: (e: React.FormEvent) => {
      e.preventDefault()
      if (submitting && submitting.disabled !== true) void submitting.onSelect()
    },
    // The listener sits on the panel, so the current target is the panel.
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Tab' && trapTab(e.currentTarget, e.shiftKey)) e.preventDefault()
    },
  }
}

function DialogContent({
  titleId,
  title,
  children,
  actions,
  onDismiss,
}: DialogProps & { titleId: string }): JSX.Element {
  return (
    <>
      <DialogHead titleId={titleId} title={title} onDismiss={onDismiss} />
      {children !== undefined && <div className="tmui-dialog__body">{children}</div>}
      <div className="tmui-dialog__actions">
        {actions.map((action) => (
          <DialogActionButton key={action.label} action={action} />
        ))}
      </div>
    </>
  )
}

function DialogHead({
  titleId,
  title,
  onDismiss,
}: { titleId: string } & Pick<DialogProps, 'title' | 'onDismiss'>): JSX.Element {
  return (
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
  )
}

const TONE_VARIANT = { default: 'secondary', primary: 'primary', danger: 'danger' } as const

export function DialogActionButton({ action }: { action: DialogAction }): JSX.Element {
  return (
    <Button
      variant={TONE_VARIANT[action.tone ?? 'default']}
      disabled={action.disabled === true}
      type={action.submit === true ? 'submit' : 'button'}
      // A submitting action runs through the form's submit event, once.
      onClick={action.submit === true ? undefined : () => void action.onSelect()}
    >
      {action.label}
      {action.shortcut !== undefined && <kbd className="tmui-kbd">{action.shortcut}</kbd>}
    </Button>
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
