import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Settings, Download, Upload, Kanban, List, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import './task-vault.css'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useVaultStore } from '../stores/vault.store'
import { useVaultNavStore } from '../stores/vault-nav.store'
import { useVaultDataStore } from '../stores/vault-data.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { VaultSidebar } from './VaultSidebar'
import { DailyLog } from './DailyLog'
import { ProjectsBrowser } from './ProjectsBrowser'
import { WeeklyReview } from './WeeklyReview'
import { InboxView } from './InboxView'
import { AreasView } from './AreasView'
import { ArchiveView } from './ArchiveView'
import { CalendarDrawer } from './CalendarDrawer'
import { SmartTaskInput } from './SmartTaskInput'
import { KanbanBoard } from './KanbanBoard'
import { TaskDetailPanel } from './TaskDetailPanel'
import { DatabaseAdmin } from './DatabaseAdmin'

export function CaptureModal(): React.JSX.Element | null {
  const { showCaptureModal, setShowCaptureModal, refreshInboxCount } = useVaultStore()
  const [text, setText] = useState('')
  const [capturing, setCapturing] = useState(false)

  const close = useCallback(() => {
    setText('')
    setShowCaptureModal(false)
  }, [setShowCaptureModal])

  useEffect(() => {
    if (!showCaptureModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showCaptureModal, close])

  if (!showCaptureModal) return null

  async function handleCapture() {
    if (!text.trim()) return
    setCapturing(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:capture', {
        text: text.trim(),
      })
      await refreshInboxCount()
      close()
    } finally {
      setCapturing(false)
    }
  }

  return createPortal(
    <div className="capture-modal__backdrop" onClick={close}>
      <div className="capture-modal" onClick={(e) => e.stopPropagation()}>
        <div className="capture-modal__header">
          <span className="capture-modal__title">Capture to Inbox</span>
          <button className="capture-modal__close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="capture-modal__body">
          <SmartTaskInput
            value={text}
            onChange={setText}
            onSubmit={handleCapture}
            onCancel={close}
            disabled={capturing}
            autoFocus
            placeholder="Task text… @project #area +context due:YYYY-MM-DD"
          />
        </div>
        <div className="capture-modal__footer">
          <button
            className="capture-modal__capture-btn"
            onClick={handleCapture}
            disabled={capturing || !text.trim()}
          >
            {capturing ? '…' : 'Capture'}
          </button>
          <span className="capture-modal__hint">Esc to dismiss · Enter to capture</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function DataToolsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { loadToday, refreshInboxCount } = useVaultStore()
  const [tab, setTab] = useState<'data' | 'admin'>('data')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setExporting(true)
    setStatus(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:export-json')
      if (result && typeof result === 'object' && 'error' in result) {
        setStatus(`Export failed: ${(result as { error: string }).error}`)
        return
      }
      const json = JSON.stringify(result, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `task-vault-export-${(() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()}.json`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Exported successfully.')
    } finally {
      setExporting(false)
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setStatus(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:import-json',
        data
      )
      if (result && typeof result === 'object' && 'error' in result) {
        setStatus(`Import failed: ${(result as { error: string }).error}`)
      } else {
        const count = (result as { imported: number }).imported
        setStatus(`Imported ${count} records successfully.`)
      }
    } catch (err) {
      setStatus(`Import failed: ${String(err)}`)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return createPortal(
    <div className="capture-modal__backdrop" onClick={onClose}>
      <div
        className="capture-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: tab === 'admin' ? 780 : 420, width: '90vw' }}
      >
        <div className="capture-modal__header">
          <div className="tv-modal-tabs">
            <button
              className={`tv-modal-tab${tab === 'data' ? ' tv-modal-tab--active' : ''}`}
              onClick={() => setTab('data')}
            >
              Data Tools
            </button>
            <button
              className={`tv-modal-tab${tab === 'admin' ? ' tv-modal-tab--active' : ''}`}
              onClick={() => setTab('admin')}
            >
              DB Admin
            </button>
          </div>
          <button className="capture-modal__close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {tab === 'data' && (
          <div
            className="capture-modal__body"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <p style={{ fontSize: 12, color: 'var(--tm-text-muted)', margin: 0 }}>
              Export your vault to JSON for backup or migration. Import merges records by ID —
              existing data is not overwritten.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="tv-btn tv-btn--primary"
                onClick={handleExport}
                disabled={exporting}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} />
                {exporting ? 'Exporting…' : 'Export JSON'}
              </button>
              <button
                className="tv-btn tv-btn--secondary"
                onClick={handleImportClick}
                disabled={importing}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Upload size={14} />
                {importing ? 'Importing…' : 'Import JSON'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
            {status && (
              <p
                style={{
                  fontSize: 12,
                  color: status.includes('failed') ? 'var(--tm-danger)' : 'var(--tm-success)',
                  margin: 0,
                }}
              >
                {status}
              </p>
            )}
          </div>
        )}

        {tab === 'admin' && (
          <div className="capture-modal__body" style={{ padding: 0 }}>
            <DatabaseAdmin
              onWrite={() => {
                void loadToday()
                void refreshInboxCount()
              }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export function TaskVaultView(): React.JSX.Element {
  const {
    todayLog,
    activeView,
    viewMode,
    setViewMode,
    selectedContexts,
    setSelectedContexts,
    toggleContext,
    isLoading,
    error,
    loadToday,
    loadDate,
    refreshInboxCount,
    rolledOverTaskIds,
    pendingTaskId,
    clearPendingTask,
    viewingDate,
    somedayTasks,
    loadSomeday,
    setKanbanLanes,
    tickCalendar,
  } = useVaultStore()
  const { addToast } = useToastStore()
  const [showDataTools, setShowDataTools] = useState(false)
  const [availableContexts, setAvailableContexts] = useState<string[]>([])
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskText, setSelectedTaskText] = useState<string>('')

  const loadSomedayTasks = loadSomeday

  const loadKanbanConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:get-config')
      if (result && typeof result === 'object' && !('error' in result)) {
        const cfg = result as { lanes: import('../vault/types').KanbanLane[] }
        setKanbanLanes(cfg.lanes)
      }
    } catch {
      // non-critical
    }
  }, [setKanbanLanes])

  const loadContexts = useCallback(async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:kanban:list-contexts'
      )
      if (result && typeof result === 'object' && 'contexts' in result) {
        setAvailableContexts((result as { contexts: string[] }).contexts)
      }
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Consume navigation intent dispatched from App.tsx (works even when this tab was unmounted)
  const pendingNavigation = useExtensionRegistry((s) => s.pendingNavigations.get('task-vault'))
  const clearPendingNavigation = useExtensionRegistry((s) => s.clearPendingNavigation)

  useEffect(() => {
    if (!pendingNavigation) return
    clearPendingNavigation('task-vault')
    const payload = pendingNavigation as { taskId: string; date?: string } | string
    const taskId = typeof payload === 'string' ? payload : payload.taskId
    const date = typeof payload === 'object' && payload.date ? payload.date : undefined
    useVaultNavStore.getState().navigateToTask(taskId, date)
    if (date) void useVaultDataStore.getState().loadDate(date)
  }, [pendingNavigation, clearPendingNavigation])

  useEffect(() => {
    if (!pendingTaskId || !todayLog) return
    const task = todayLog.tasks.find((t) => t.id === pendingTaskId)
    if (task) {
      setSelectedTaskId(pendingTaskId)
      setSelectedTaskText(task.text)
    }
    clearPendingTask()
  }, [pendingTaskId, todayLog, clearPendingTask])

  useEffect(() => {
    loadToday()
    refreshInboxCount()
    void loadContexts()
    void loadSomedayTasks()
    void loadKanbanConfig()

    const unsubIndexUpdated = window.electronAPI.extensionBridge.on(
      'task-vault:push:index-updated',
      () => {
        const vd = useVaultNavStore.getState().viewingDate
        if (vd) void loadDate(vd)
        else loadToday()
        refreshInboxCount()
        void loadContexts()
        void loadSomedayTasks()
      }
    )

    const unsubExternal = window.electronAPI.extensionBridge.on(
      'task-vault:push:file-changed-externally',
      () => {
        const vd = useVaultNavStore.getState().viewingDate
        if (vd) void loadDate(vd)
        else loadToday()
      }
    )

    const unsubRecurrenceSpawned = window.electronAPI.extensionBridge.on(
      'task-vault:recurrence-spawned',
      () => {
        tickCalendar()
        const vd = useVaultNavStore.getState().viewingDate
        if (vd) void loadDate(vd)
        else loadToday()
      }
    )

    return () => {
      unsubIndexUpdated()
      unsubExternal()
      unsubRecurrenceSpawned()
    }
  }, [])

  function makeTaskNavHandler(taskId: string): () => void {
    return () => {
      useExtensionRegistry.getState().setActiveGlobalTab('task-vault')
      useVaultNavStore.getState().navigateToTask(taskId)
    }
  }

  async function handleComplete(taskId: string) {
    const taskText = (todayLog?.tasks ?? []).find((t) => t.id === taskId)?.text ?? ''
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', { taskId })
    addToast({
      type: 'success',
      message: taskText ? `Completed: ${taskText}` : 'Task completed',
      onClick: makeTaskNavHandler(taskId),
    })
    if (viewingDate) await loadDate(viewingDate)
    else await loadToday()
  }

  async function handlePickUpToday(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:someday-to-today', { taskId })
    await loadToday()
    await loadSomedayTasks()
  }

  async function handleDeleteBacklogTask(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId })
    await loadSomedayTasks()
  }

  async function handleMigrate(taskId: string, targetDate: string) {
    const taskText = (todayLog?.tasks ?? []).find((t) => t.id === taskId)?.text ?? ''
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:migrate-task', {
      taskId,
      targetDate,
    })
    addToast({
      type: 'info',
      message: taskText ? `Migrated: ${taskText}` : 'Task migrated',
      onClick: makeTaskNavHandler(taskId),
    })
    if (viewingDate) await loadDate(viewingDate)
    else await loadToday()
  }

  // Day navigation helpers
  const todayStr = (() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  const currentDate = viewingDate ?? todayStr
  const isToday = viewingDate === null || viewingDate === todayStr

  function goToPrevDay() {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    const prev = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    void loadDate(prev)
  }

  function goToNextDay() {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    const next = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    void loadDate(next)
  }

  function handleSelectTask(taskId: string | null) {
    if (taskId === null) {
      setSelectedTaskId(null)
      setSelectedTaskText('')
      return
    }
    // Toggle off if same task clicked again
    if (taskId === selectedTaskId) {
      setSelectedTaskId(null)
      setSelectedTaskText('')
      return
    }
    const allTasks = [...(todayLog?.tasks ?? []), ...somedayTasks]
    const task = allTasks.find((t) => t.id === taskId)
    setSelectedTaskId(taskId)
    setSelectedTaskText(task?.text ?? '')
  }

  return (
    <div className="task-vault-view">
      {showDataTools && <DataToolsModal onClose={() => setShowDataTools(false)} />}
      <VaultSidebar />
      <div className="task-vault-view__content">
        <div className="task-vault-view__toolbar-row">
          <div className="task-vault-view__toolbar">
            <div className="task-vault-view__toolbar-right">
              <button
                className={`tv-btn tv-btn--xs${viewMode === 'list' ? ' tv-btn--secondary' : ' tv-btn--ghost'}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <List size={13} />
              </button>
              <button
                className={`tv-btn tv-btn--xs${viewMode === 'kanban' ? ' tv-btn--secondary' : ' tv-btn--ghost'}`}
                onClick={() => setViewMode('kanban')}
                title="Kanban view"
              >
                <Kanban size={13} />
              </button>
              <div className="tv-context-filter" ref={contextMenuRef}>
                <button
                  className={`tv-btn tv-btn--xs tv-context-filter__btn${selectedContexts.length > 0 ? ' tv-btn--secondary' : ' tv-btn--ghost'}`}
                  onClick={() => setContextMenuOpen((v) => !v)}
                  title="Filter by context"
                >
                  {selectedContexts.length === 0
                    ? 'Context'
                    : selectedContexts.length === 1
                      ? `+${selectedContexts[0]}`
                      : `${selectedContexts.length} contexts`}
                  <ChevronDown size={11} />
                </button>
                {contextMenuOpen && (
                  <div className="tv-context-filter__dropdown">
                    <div className="tv-context-filter__header">
                      <span className="tv-context-filter__heading">Filter by context</span>
                      {selectedContexts.length > 0 && (
                        <button
                          className="tv-context-filter__clear"
                          onClick={() => setSelectedContexts([])}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {availableContexts.length === 0 && (
                      <span className="tv-context-filter__empty">No contexts found</span>
                    )}
                    {availableContexts.map((ctx) => {
                      const checked = selectedContexts.includes(ctx)
                      return (
                        <label key={ctx} className="tv-context-filter__option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleContext(ctx)}
                            className="tv-context-filter__checkbox"
                          />
                          <span>+{ctx}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <button
                className="tv-btn tv-btn--ghost task-vault-view__tools-btn"
                onClick={() => setShowDataTools(true)}
                title="Data tools (export / import)"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
        </div>
        {viewMode === 'kanban' && activeView !== 'review' ? (
          <KanbanBoard />
        ) : (
          <div className="task-vault-view__main">
            <div className="task-vault-view__list">
              {activeView === 'daily' && isLoading && (
                <div className="task-vault-view__loading">Loading…</div>
              )}
              {activeView === 'daily' && error && (
                <div className="task-vault-view__error">{error}</div>
              )}
              {activeView === 'daily' && !isLoading && !error && todayLog && (
                <DailyLog
                  log={todayLog}
                  rolledOverTaskIds={rolledOverTaskIds}
                  selectedContexts={selectedContexts}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={handleSelectTask}
                  onTaskComplete={handleComplete}
                  onTaskMigrate={handleMigrate}
                  onRefresh={
                    isToday
                      ? async () => {
                          await loadToday()
                          await loadSomedayTasks()
                        }
                      : () => loadDate(currentDate)
                  }
                  onPrevDay={goToPrevDay}
                  onNextDay={goToNextDay}
                  onGoToToday={loadToday}
                  isToday={isToday}
                  somedayTasks={somedayTasks}
                  onPickUpToday={handlePickUpToday}
                  onDeleteBacklogTask={handleDeleteBacklogTask}
                  onRefreshBacklog={loadSomedayTasks}
                />
              )}
              {activeView === 'daily' && !isLoading && !error && !todayLog && (
                <div className="task-vault-view__empty">
                  No vault configured. Set vault path in settings.
                </div>
              )}
              {activeView === 'inbox' && <InboxView />}
              {activeView === 'projects' && <ProjectsBrowser />}
              {activeView === 'areas' && <AreasView />}
              {activeView === 'archive' && <ArchiveView />}
              {activeView === 'review' && <WeeklyReview />}
            </div>
            {selectedTaskId && activeView === 'daily' && (
              <>
                <div className="tv-detail-panel__backdrop" onClick={() => handleSelectTask(null)} />
                <TaskDetailPanel
                  taskId={selectedTaskId}
                  taskText={selectedTaskText}
                  onClose={() => handleSelectTask(null)}
                />
              </>
            )}
            {activeView === 'daily' && <CalendarDrawer />}
          </div>
        )}
      </div>
    </div>
  )
}
