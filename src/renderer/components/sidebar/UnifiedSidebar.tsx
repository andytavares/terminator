import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { SidebarHeader } from './SidebarHeader'
import { ScratchSection } from './ScratchSection'
import { WorkspaceCard } from './WorkspaceCard'
import './UnifiedSidebar.css'

interface UnifiedSidebarProps {
  globalTabs: GlobalTabRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void
  activeWorkspaceTabId: string | null
  onSelectWorkspaceTab: (workspaceId: string, tabId: string) => void
  onSelectProject?: () => void
  unreadNotifications: number
  notificationPanelOpen: boolean
  onBellClick: () => void
  scratchActive: boolean
  hasScratchSessions: boolean
  onNewScratch: () => void
  activeScratchSessionId: string | null
  onSelectScratchSession: (sessionId: string) => void
  visible: boolean
}

const SIDEBAR_WIDTH_KEY = 'terminator.sidebar.width'
const DEFAULT_WIDTH = 260
const MIN_WIDTH = 200
const MAX_WIDTH = 480

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH
}

export function UnifiedSidebar({
  globalTabs,
  activeGlobalTabId,
  onSelectGlobalTab,
  activeWorkspaceTabId,
  onSelectWorkspaceTab,
  onSelectProject,
  unreadNotifications,
  onBellClick,
  onNewScratch,
  activeScratchSessionId,
  onSelectScratchSession,
  visible,
}: UnifiedSidebarProps): JSX.Element {
  const {
    workspaces,
    activeProjectId,
    activeWorkspaceId,
    projectsByWorkspaceId,
    expandedWorkspaceIds,
    toggleWorkspaceCollapse,
    setActiveProject,
    setActiveWorkspace,
    loadProjects,
  } = useWorkspaceStore()
  const { getScratchSessions } = useSessionStore()
  const scratchSessions = getScratchSessions()

  // Eager-load projects for every workspace that has not been fetched yet.
  // The unified sidebar shows all workspaces simultaneously, so we cannot
  // rely on setActiveWorkspace to trigger loadProjects one-at-a-time.
  useEffect(() => {
    for (const ws of workspaces) {
      if (!projectsByWorkspaceId.has(ws.id)) {
        void loadProjects(ws.id)
      }
    }
  }, [workspaces, projectsByWorkspaceId, loadProjects])

  const [width, setWidth] = useState(readStoredWidth)
  const [createWsOpen, setCreateWsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const sidebarRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  const dragStartXRef = useRef<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const { reorderWorkspaces } = useWorkspaceStore()

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartXRef.current = e.clientX

    function onMouseMove(ev: MouseEvent): void {
      if (dragStartXRef.current === null) return
      const dx = ev.clientX - dragStartXRef.current
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthRef.current + dx))
      if (sidebarRef.current) sidebarRef.current.style.width = `${next}px`
    }

    function onMouseUp(ev: MouseEvent): void {
      if (dragStartXRef.current === null) return
      const dx = ev.clientX - dragStartXRef.current
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthRef.current + dx))
      widthRef.current = next
      setWidth(next)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
      } catch {
        // ignore
      }
      dragStartXRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  function handleResizeDblClick(): void {
    widthRef.current = DEFAULT_WIDTH
    setWidth(DEFAULT_WIDTH)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    widthRef.current = width
  }, [width])

  function handleDragStart(index: number): void {
    dragIndexRef.current = index
  }

  function handleDragOver(e: React.DragEvent, index: number): void {
    e.preventDefault()
    setDragOver(index)
  }

  function handleDrop(dropIndex: number): void {
    const fromIndex = dragIndexRef.current
    if (fromIndex === null || fromIndex === dropIndex) {
      setDragOver(null)
      dragIndexRef.current = null
      return
    }
    const reordered = [...workspaces]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(dropIndex, 0, moved)
    void reorderWorkspaces(reordered.map((w) => w.id))
    dragIndexRef.current = null
    setDragOver(null)
  }

  return (
    <>
      <div
        ref={sidebarRef}
        className={`unified-sidebar${visible ? '' : ' unified-sidebar--hidden'}`}
        style={{ width }}
      >
        <SidebarHeader
          globalTabs={globalTabs}
          activeGlobalTabId={activeGlobalTabId}
          onSelectGlobalTab={onSelectGlobalTab}
          onSearchFocus={() => {}}
          onAddWorkspace={() => setCreateWsOpen(true)}
          unreadNotifications={unreadNotifications}
          onBellClick={onBellClick}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClear={() => setSearchQuery('')}
        />

        <div className="unified-sidebar__list">
          {workspaces.map((ws, index) => (
            <div
              key={ws.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                dragIndexRef.current = null
                setDragOver(null)
              }}
              className={dragOver === index ? 'ws-card--dnd-over' : ''}
            >
              <WorkspaceCard
                workspace={ws}
                projects={projectsByWorkspaceId.get(ws.id) ?? []}
                isCollapsed={!expandedWorkspaceIds.has(ws.id)}
                onToggleCollapse={() => toggleWorkspaceCollapse(ws.id)}
                activeProjectId={activeProjectId}
                onSelectProject={(projectId) => {
                  setActiveWorkspace(ws.id)
                  setActiveProject(projectId)
                  onSelectProject?.()
                }}
                onSelectWorkspaceTab={onSelectWorkspaceTab}
                activeWorkspaceTabId={activeWorkspaceId === ws.id ? activeWorkspaceTabId : null}
                searchQuery={searchQuery}
              />
            </div>
          ))}
        </div>

        <ScratchSection
          sessions={scratchSessions}
          activeSessionId={activeScratchSessionId}
          onSelectSession={onSelectScratchSession}
          onNewScratch={onNewScratch}
        />

        <div
          className="unified-sidebar__resize-handle"
          onMouseDown={handleResizeMouseDown}
          onDoubleClick={handleResizeDblClick}
        />
      </div>

      {createWsOpen && <CreateWorkspaceDialog onClose={() => setCreateWsOpen(false)} />}
    </>
  )
}
