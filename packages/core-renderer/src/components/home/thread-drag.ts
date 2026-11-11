import type React from 'react'
import { useState } from 'react'
import { create } from 'zustand'
import { SESSION_DRAG_TYPE } from '../agent/session-drag'
import { useToastStore } from '../../stores/toast.store'
import { canMergeThreads, mergeThreads, undoMerge } from './task-actions'
import type { WorkThread } from '../../home/work-threads'

// Drag one Home row onto another to merge them. Both rows are in one window, so plain HTML drag
// and drop is enough; the dragged row is held here because a drag event cannot carry objects.

export const THREAD_DRAG_TYPE = 'application/x-terminator-thread'
/** The thread being dragged, from a Home row or an Inbox card; null when none is. */
export const useDraggedThread = create<{ thread: WorkThread | null }>(() => ({ thread: null }))

/** Merges, then says what happened, with Undo. */
async function mergeAndSay(dragged: WorkThread, target: WorkThread): Promise<void> {
  const undo = await mergeThreads(dragged, target)
  const toasts = useToastStore.getState()
  if (undo === null) {
    toasts.addToast({ type: 'error', message: 'The tasks could not be merged. Try again.' })
    return
  }
  toasts.addToast({
    type: 'info',
    message: `Moved "${dragged.title}" into "${target.title}"`,
    duration: 6000,
    action: { label: 'Undo', onSelect: () => void undoMerge(undo) },
  })
}

function accepts(target: WorkThread): boolean {
  const dragged = useDraggedThread.getState().thread
  return dragged !== null && canMergeThreads(dragged, target)
}

function dropOn(target: WorkThread): void {
  const dragged = useDraggedThread.getState().thread
  useDraggedThread.setState({ thread: null })
  if (dragged !== null && canMergeThreads(dragged, target)) void mergeAndSay(dragged, target)
}

/** Starts a drag that carries the thread's sessions to an agent tab or a terminal. */
export function carryThread(event: React.DragEvent, thread: WorkThread): void {
  event.dataTransfer.setData(THREAD_DRAG_TYPE, thread.key)
  event.dataTransfer.setData(
    SESSION_DRAG_TYPE,
    thread.lanes.flatMap((lane) => lane.sessionIds).join('\n')
  )
  event.dataTransfer.effectAllowed = 'copyMove'
  useDraggedThread.setState({ thread })
}

/** The held thread, when this drag carries one; a source that unmounts mid-drag never clears it. */
export function heldThreadOf(types: readonly string[]): WorkThread | null {
  return types.includes(THREAD_DRAG_TYPE) ? useDraggedThread.getState().thread : null
}

export interface MergeDrop {
  /** Something that can merge is held over this row. */
  over: boolean
  props: React.HTMLAttributes<HTMLElement> & { draggable: boolean }
}

/** The drag handlers for one row: it can be picked up unless it is being renamed, and another
 *  row can be dropped on it. */
export function useMergeDrop(thread: WorkThread, renaming: boolean): MergeDrop {
  const [over, setOver] = useState(false)
  const props: MergeDrop['props'] = {
    // A draggable row would take a drag in its rename field, so text could not be selected.
    draggable: thread.lanes.length > 0 && !renaming,
    onDragStart: (event) => carryThread(event, thread),
    onDragEnd: () => useDraggedThread.setState({ thread: null }),
    onDragOver: (event) => {
      if (!accepts(thread)) return
      event.preventDefault()
      setOver(true)
    },
    onDragLeave: (event) => {
      // Moving onto one of the row's own chips leaves the row too; only leaving it counts.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
    },
    onDrop: (event) => {
      event.preventDefault()
      setOver(false)
      dropOn(thread)
    },
  }
  return { over, props }
}
