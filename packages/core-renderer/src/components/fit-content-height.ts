import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'

// A fit=content page first reports its empty layout, before the extension draws, so a section
// above other content would jump: the frame starts at the height it settled on last time.

/** @internal How long a frame's page may stay empty before its height is taken as final. */
export const FRAME_SETTLE_LIMIT_MS = 1000

/** The window message the frame shim posts with its content height. */
const FRAME_HEIGHT_MESSAGE = 'terminator:frame-height'

const REMEMBERED_HEIGHT_PREFIX = 'terminator.frame-height.'

interface Surface {
  extensionId: string
  viewParam: string
}

/** Told, with the extension's id, once its frame has a height worth showing.
 * @internal */
export const FrameHeightReadyContext = createContext<(extensionId: string) => void>(() => {})

function rememberedHeightKey({ extensionId, viewParam }: Surface): string {
  return `${REMEMBERED_HEIGHT_PREFIX}${extensionId}.${viewParam}`
}

function loadRememberedHeight(surface: Surface): number | null {
  try {
    const stored = localStorage.getItem(rememberedHeightKey(surface))
    const height = stored === null ? NaN : Number(stored)
    return Number.isFinite(height) && height >= 0 ? height : null
  } catch {
    return null
  }
}

function rememberHeight(surface: Surface, height: number): void {
  try {
    localStorage.setItem(rememberedHeightKey(surface), String(height))
  } catch {
    // Storage full or blocked: the next frame starts at 0px, as a first one does.
  }
}

/** The height the frame's own page last reported; other windows' messages do not count. */
function useReportedHeight(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  enabled: boolean
): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { type?: string; height?: unknown } | null
      if (data?.type !== FRAME_HEIGHT_MESSAGE || typeof data.height !== 'number') return
      setHeight(Math.max(0, data.height))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef, enabled])
  return height
}

/** True from the page's first report with content, or once the settle limit passes. */
function useSettled(reported: number | null, enabled: boolean): boolean {
  const [timedOut, setTimedOut] = useState(false)
  const [sawContent, setSawContent] = useState(false)
  const hasContent = reported !== null && reported > 0
  // Latched in render, so a page that later empties stays settled at 0px.
  if (hasContent && !sawContent) setSawContent(true)
  useEffect(() => {
    if (!enabled) return
    const timer = setTimeout(() => setTimedOut(true), FRAME_SETTLE_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [enabled])
  return timedOut || sawContent || hasContent
}

/** A fit=content frame's height: the remembered one until its page settles. Null otherwise. */
export function useFitContentHeight(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  surface: Surface,
  enabled: boolean
): number | null {
  const [remembered] = useState(() => (enabled ? loadRememberedHeight(surface) : null))
  const reported = useReportedHeight(iframeRef, enabled)
  const settled = useSettled(reported, enabled)
  useRememberSettledHeight(surface, settled && enabled ? reported : null)
  useReadyNotice(surface.extensionId, enabled && (remembered !== null || settled))
  if (!enabled) return null
  return settled ? (reported ?? remembered ?? 0) : (remembered ?? 0)
}

function useRememberSettledHeight(surface: Surface, height: number | null): void {
  const { extensionId, viewParam } = surface
  useEffect(() => {
    if (height !== null) rememberHeight({ extensionId, viewParam }, height)
  }, [extensionId, viewParam, height])
}

/** Tells the host once, before paint, so a held body never shows a frame at the wrong height. */
function useReadyNotice(extensionId: string, ready: boolean): void {
  const notifyReady = useContext(FrameHeightReadyContext)
  useLayoutEffect(() => {
    if (ready) notifyReady(extensionId)
  }, [ready, extensionId, notifyReady])
}
