import React, { useId } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { ModalShell } from './ModalShell'
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
  /** The dialog's form submission: Enter in a field runs it, as in any form. At most one action
   * submits; the content sits in a `<form>` when one does. */
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

const PANEL_CLASS = {
  default: 'tmui-dialog__panel',
  wide: 'tmui-dialog__panel tmui-dialog__panel--wide',
}

/** One dialog for the whole product: the modal shell with a title, a body and one to three
 * actions. It renders in the caller's own React tree (ADR 038), over the view it was opened from. */
export function Dialog(props: DialogProps): React.JSX.Element {
  const { dismissible = true, size = 'default', actions, onDismiss } = props
  const titleId = useId()
  return (
    <ModalShell
      className={PANEL_CLASS[size]}
      labelledBy={titleId}
      dismissible={dismissible}
      onDismiss={onDismiss}
    >
      <DialogForm submitting={actions.find((action) => action.submit === true)}>
        <DialogContent {...props} titleId={titleId} />
      </DialogForm>
    </ModalShell>
  )
}

interface DialogFormProps {
  submitting: DialogAction | undefined
  children: React.ReactNode
}

/** A `<form>` when one action submits, so Enter in a field runs it; else the content as it is. */
function DialogForm({ submitting, children }: DialogFormProps): React.JSX.Element {
  if (!submitting) return <>{children}</>
  return (
    <form
      className="tmui-dialog__form"
      onSubmit={(e) => {
        e.preventDefault()
        if (submitting.disabled !== true) void submitting.onSelect()
      }}
    >
      {children}
    </form>
  )
}

/** The close control comes last, so the dialog opens on its first field or, with none, on its
 * first action: the safe one, never the close. */
function DialogContent(props: DialogProps & { titleId: string }): React.JSX.Element {
  const { children, onDismiss } = props
  return (
    <>
      <h2 id={props.titleId} className="tmui-dialog__title">
        {props.title}
      </h2>
      {children !== undefined && <div className="tmui-dialog__body">{children}</div>}
      <div className="tmui-dialog__actions">
        {props.actions.map((action) => (
          <DialogActionButton key={action.label} action={action} />
        ))}
      </div>
      <button
        type="button"
        className="tmui-icon-button tmui-dialog__close"
        aria-label="Close"
        title="Close"
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </button>
    </>
  )
}

const TONE_VARIANT = { default: 'secondary', primary: 'primary', danger: 'danger' } as const

export function DialogActionButton({ action }: { action: DialogAction }): React.JSX.Element {
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
