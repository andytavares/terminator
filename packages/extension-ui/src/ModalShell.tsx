import React, { useLayoutEffect, useRef } from 'react'
import { createModalDepthRegistry } from './modal-depth'
import { enterModalStack } from './modal-stack'
import './extension-ui.css'

export interface ModalShellProps {
  /** Names the surface for assistive technology when it shows no title of its own. */
  label?: string
  /** The id of the surface's visible title, in place of `label`. */
  labelledBy?: string
  children: React.ReactNode
  /** The caller's own look and placement; the shell itself draws only the backdrop. */
  className?: string
  /** Where the surface sits: the middle of the window (the default), or horizontally centred
   * near the top, as a launcher does. */
  placement?: 'center' | 'top'
  /** When false, Escape and a press outside do not dismiss: for unsaved work, which must offer
   * its own way out. */
  dismissible?: boolean
  /** Called for Escape, a phone's back gesture and a press outside. The caller then removes it. */
  onDismiss: () => void
}

/** The modal behaviour with no content of its own: a native `<dialog>`, open as a modal for as
 * long as it is mounted (ADR 110). Focus opens on the first control inside, or on the field
 * that asks for it with `autoFocus`, and returns to whatever had it. */
export function ModalShell(props: ModalShellProps): JSX.Element {
  const { dismissible = true, placement = 'center' } = props
  const className = [props.className, placement === 'top' && 'tmui-modal--top']
    .filter(Boolean)
    .join(' ')
  return (
    <dialog
      data-tmui-panel=""
      className={className ? `tmui-modal ${className}` : 'tmui-modal'}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      {...dismissalEvents(dismissible, props.onDismiss)}
    >
      <OpensTheDialog />
      {props.children}
    </dialog>
  )
}

/** Opens the dialog around it, and closes it on unmount. It comes before the content because
 * React runs a first child's layout effect before it focuses an `autoFocus` field further on,
 * and a field in a dialog not yet open cannot take focus. */
function OpensTheDialog(): JSX.Element {
  const markRef = useRef<HTMLTemplateElement>(null)
  // A layout effect: close() hands focus back only while the element is still in the document.
  useLayoutEffect(() => {
    const dialog = markRef.current?.closest('dialog')
    if (!dialog) return
    const releaseDepth = createModalDepthRegistry(window).release()
    const leaveStack = enterModalStack(dialog)
    dialog.showModal()
    return () => {
      leaveStack()
      releaseDepth()
      dialog.close()
    }
  }, [])
  return <template ref={markRef} />
}

type DialogEvent = React.SyntheticEvent<HTMLDialogElement>

function dismissalEvents(dismissible: boolean, onDismiss: () => void) {
  return {
    // The caller unmounts it, so the browser never closes it on its own.
    onCancel: (event: DialogEvent) => {
      if (!isOwn(event)) return
      event.preventDefault()
      if (dismissible) onDismiss()
    },
    // A second Escape with no click between is a `cancel` that cannot be prevented (HTML spec,
    // close watchers): the browser closes the dialog, and a shell still mounted opens it again.
    onClose: (event: DialogEvent) => {
      if (isOwn(event) && event.currentTarget.isConnected) event.currentTarget.showModal()
    },
    // Preventing the key's default is the one way to refuse every Escape, not only the first.
    onKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (!dismissible && event.key === 'Escape' && isPressedHere(event)) event.preventDefault()
    },
    // A press on the backdrop lands on the dialog itself, as does one on its own padding.
    onMouseDown: (event: React.MouseEvent<HTMLDialogElement>) => {
      if (dismissible && isOwn(event) && isOutsideBox(event)) onDismiss()
    },
  }
}

/** False for an event React passed up from a dialog nested inside, or that bubbled from a field. */
function isOwn(event: DialogEvent): boolean {
  return event.target === event.currentTarget
}

/** Whether the key was pressed in this dialog, not in one opened from inside it. */
function isPressedHere(event: React.KeyboardEvent<HTMLDialogElement>): boolean {
  return (event.target as Element).closest('dialog') === event.currentTarget
}

function isOutsideBox(event: React.MouseEvent<HTMLDialogElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect()
  const { clientX, clientY } = event
  return clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom
}
