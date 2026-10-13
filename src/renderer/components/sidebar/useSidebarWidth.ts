import type React from 'react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const SIDEBAR_WIDTH_KEY = 'terminator.sidebar.width'
// The branch row carries name, state, worktree marker and change statistics.
// 260px truncated a 30-character branch name to uselessness, which is the
// ambiguity this feature exists to remove (research R3).
const DEFAULT_WIDTH = 300
const MIN_WIDTH = 200
const MAX_WIDTH = 480

const clampWidth = (width: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return clampWidth(n)
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH
}

function storeWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  } catch {
    // ignore
  }
}

/**
 * The sidebar's width: stored across launches, dragged from its handle (the
 * element follows the pointer, state is written once on release), and reset
 * to the default by a double click.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(readStoredWidth)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)

  useEffect(() => {
    widthRef.current = width
  }, [width])

  const commit = useCallback((next: number) => {
    widthRef.current = next
    setWidth(next)
    storeWidth(next)
  }, [])

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      trackResize(e.clientX, { sidebarRef, widthRef, commit })
    },
    [commit]
  )

  return { width, sidebarRef, onResizeMouseDown, onResizeDoubleClick: () => commit(DEFAULT_WIDTH) }
}

interface ResizeTarget {
  sidebarRef: RefObject<HTMLDivElement>
  widthRef: { readonly current: number }
  commit: (width: number) => void
}

/** Follows the pointer from `startX` until release, then commits the width it ended on. */
function trackResize(startX: number, { sidebarRef, widthRef, commit }: ResizeTarget): void {
  const widthAt = (ev: MouseEvent): number => clampWidth(widthRef.current + ev.clientX - startX)

  function onMouseMove(ev: MouseEvent): void {
    if (sidebarRef.current) sidebarRef.current.style.width = `${widthAt(ev)}px`
  }

  function onMouseUp(ev: MouseEvent): void {
    commit(widthAt(ev))
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
