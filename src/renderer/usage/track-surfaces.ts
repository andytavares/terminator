import { useEffect, useRef, useState } from 'react'
import { useExtensionRegistry } from '../extensions/registry'
import { buildCoreActions, type CoreActionDeps } from '../quick-actions/core-actions'
import type { FeatureDeclaration } from '../../shared/schemas/usage.schema'
import { ActiveTimeTracker, type ActiveSpan } from './active-time'
import { declareFeatures, recordUse } from './record'
import { FRAME_ACTIVITY_MESSAGE } from '../../shared/frame-wire'

const APP_ACTIVE = 'core.app.active'

type Slot = 'global-tab' | 'workspace-tab' | 'project-tab' | 'sidebar-panel'
type Registry = ReturnType<typeof useExtensionRegistry.getState>

/** A core surface is its own feature; an extension's is its registration id plus the slot it fills. */
function surfaceFeatureId(registrationId: string, slot: Slot): string {
  return registrationId.startsWith('core.') ? registrationId : `${registrationId}.${slot}`
}

/** The features of every surface the registry holds, so one never opened still shows up. */
function declaredSurfaces(registry: Registry): FeatureDeclaration[] {
  const slots: Array<[Slot, Iterable<{ id: string; label: string }>]> = [
    ['global-tab', registry.globalTabs.values()],
    ['workspace-tab', registry.workspaceTabs.values()],
    ['project-tab', registry.projectTabs.values()],
    ['sidebar-panel', registry.sidebarPanels.values()],
  ]
  return slots.flatMap(([slot, registrations]) =>
    [...registrations].map(({ id, label }) => ({
      id: surfaceFeatureId(id, slot),
      label,
      kind: 'surface' as const,
      source: id.startsWith('core.') ? 'core' : id,
    }))
  )
}

/** The surfaces on screen now: the active tab of each kind and every open panel. */
function activeSurfaceIds(registry: Registry): string[] {
  const { activeGlobalTabId, activeWorkspaceTabId, activeProjectTabId, openPanels } = registry
  const tabs: Array<[string | null, Slot]> = [
    [activeGlobalTabId, 'global-tab'],
    [activeWorkspaceTabId, 'workspace-tab'],
    [activeProjectTabId, 'project-tab'],
  ]
  return [
    ...tabs.flatMap(([id, slot]) => (id ? [surfaceFeatureId(id, slot)] : [])),
    ...[...openPanels].map((id) => surfaceFeatureId(id, 'sidebar-panel')),
  ]
}

/** The core quick actions with their labels, so one never run still shows up. The labels that
 * depend on the focused issue are read with nothing focused. */
function declaredCoreActions(): FeatureDeclaration[] {
  const nothingFocused = {
    hasProjectFocused: false,
    hasTerminalFocused: false,
    activeWorkspaceId: null,
    workspaces: [],
    sessions: [],
    issueLink: null,
    issue: null,
  }
  const deps = new Proxy(nothingFocused, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
  }) as unknown as CoreActionDeps
  return buildCoreActions(deps).map(({ id, label }) => ({
    id,
    label,
    kind: 'action',
    source: 'core',
  }))
}

function reportSpans(spans: ActiveSpan[]): void {
  for (const { id, activeMs } of spans) recordUse(id, 'shown', { activeMs })
}

/** Declares the surfaces and core actions, again whenever the registrations change. */
function useDeclarations(): void {
  const globalTabs = useExtensionRegistry((s) => s.globalTabs)
  const workspaceTabs = useExtensionRegistry((s) => s.workspaceTabs)
  const projectTabs = useExtensionRegistry((s) => s.projectTabs)
  const sidebarPanels = useExtensionRegistry((s) => s.sidebarPanels)
  useEffect(() => {
    declareFeatures([
      ...declaredCoreActions(),
      ...declaredSurfaces(useExtensionRegistry.getState()),
    ])
  }, [globalTabs, workspaceTabs, projectTabs, sidebarPanels])
}

/** One use for each surface that becomes active, and the tracker told what is on screen. */
function useActiveSurfaces(tracker: ActiveTimeTracker): void {
  const activeIds = useExtensionRegistry((s) => activeSurfaceIds(s).join('\n'))
  const shown = useRef(new Set<string>())
  useEffect(() => {
    const ids = activeIds ? activeIds.split('\n') : []
    for (const id of ids) if (!shown.current.has(id)) recordUse(id, 'shown')
    shown.current = new Set(ids)
    reportSpans(tracker.setIds([APP_ACTIVE, ...ids], Date.now()))
  }, [activeIds, tracker])
}

/** Whether `source` is one of this window's frames: an extension view reporting its input. */
function isOwnFrame(source: MessageEventSource | null): boolean {
  return [...document.querySelectorAll('iframe')].some((frame) => frame.contentWindow === source)
}

/** Tells the tracker about focus and input, and flushes its time when the window goes away.
 * Focus moving into an extension view blurs this window, yet the window is still in use. */
function useWindowActivity(tracker: ActiveTimeTracker): void {
  useEffect(() => {
    const onInput = (): void => tracker.input(Date.now())
    const onFocus = (): void => void tracker.setFocused(true, Date.now())
    const onBlur = (): void => {
      if (document.activeElement instanceof HTMLIFrameElement) return onInput()
      reportSpans(tracker.setFocused(false, Date.now()))
    }
    const onFrameInput = (event: MessageEvent): void => {
      if (event.data?.type === FRAME_ACTIVITY_MESSAGE && isOwnFrame(event.source)) onInput()
    }
    const onLeave = (): void => reportSpans(tracker.flushAll(Date.now()))
    if (document.hasFocus()) onFocus()
    window.addEventListener('keydown', onInput, true)
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('message', onFrameInput)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('keydown', onInput, true)
      window.removeEventListener('pointerdown', onInput, true)
      window.removeEventListener('message', onFrameInput)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onLeave)
      onLeave()
    }
  }, [tracker])
}

/** Counts every surface that becomes active and how long it stays in use. Mount once. */
export function useTrackSurfaces(): void {
  const [tracker] = useState(() => new ActiveTimeTracker())
  useDeclarations()
  useActiveSurfaces(tracker)
  useWindowActivity(tracker)
}
