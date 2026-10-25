import type React from 'react'
import { useState } from 'react'
import { create } from 'zustand'
import { useToastStore } from '../../stores/toast.store'
import { canMergeThreads, mergeThreads, undoMerge } from './task-actions'
import type { WorkThread } from '../../home/work-threads'

// Drag one Home row onto another to merge them. Both rows are in one window, so plain HTML drag
// and drop is enough; the dragged row is held here because a drag event cannot carry objects.

const THREAD_TYPE = 'application/x-terminator-thread'
const useDraggedThread = create<{ thread: WorkThread | null }>(() => ({ thread: null }))

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
    onDragStart: (event) => {
      event.dataTransfer.setData(THREAD_TYPE, thread.key)
      event.dataTransfer.effectAllowed = 'move'
      useDraggedThread.setState({ thread })
    },
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
