import type React from 'react'
import { breakOut } from './breakout'

/** Carried by a drag of a terminal's tab, and never as plain text: a terminal must not paste
 * its own id when dropped on another one. */
export const SESSION_DRAG_TYPE = 'application/x-terminator-session'

interface Pointer {
  outside: boolean
  x: number
  y: number
}

// The breakout windows share this JS context, so a drag started in any of them is known here.
let draggedSessionId: string | null = null

export function startSessionDrag(sessionId: string): void {
  draggedSessionId = sessionId
}

export function draggedSession(): string | null {
  return draggedSessionId
}

export function endSessionDrag(): void {
  draggedSessionId = null
}

/** Marks the drag as carrying this terminal. */
export function beginSessionDrag(e: React.DragEvent, sessionId: string): void {
  e.dataTransfer.setData(SESSION_DRAG_TYPE, sessionId)
  startSessionDrag(sessionId)
}

export function isSessionDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(SESSION_DRAG_TYPE)
}

/** A drag that nothing accepted, ending over no Terminator window, asks for a window of its own. */
export function shouldBreakOut({
  dropEffect,
  pointer,
}: {
  dropEffect: string
  pointer: Pointer
}): boolean {
  return dropEffect === 'none' && pointer.outside
}

/** Ends the drag of a tab and, if it was dropped on nothing, opens the terminal where it landed. */
export async function finishSessionDrag(sessionId: string, dropEffect: string): Promise<void> {
  endSessionDrag()
  const pointer = await window.electronAPI.breakout.pointerOutside()
  if (shouldBreakOut({ dropEffect, pointer })) breakOut(sessionId, { x: pointer.x, y: pointer.y })
}
