import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Download, Kanban, List, Settings, Upload } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Button,
  Dialog,
  IconButton,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
  useDismissible,
} from '@terminator/extension-ui'
import './task-vault.css'
import { notify } from '../utils/notify'
import { useVaultStore } from '../stores/vault.store'
import type { VaultView } from '../stores/vault.store'
import { useVaultDataStore } from '../stores/vault-data.store'
import type { KanbanLane } from '../vault/types'
import { useVaultNavStore } from '../stores/vault-nav.store'
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
import { invokeVault, makeTaskNavHandler } from './daily-log-format'
import { localDate } from '../utils/local-date'

interface NavigationTarget {
  date?: string
  taskId?: string
  view?: 'daily' | 'review'
}

interface Selected {
  id: string | null
  text: string
}

interface ToolbarProps {
  availableContexts: string[]
  showCalendar: boolean
  onToggleCalendar: () => void
  onDataTools: () => void
}

interface DailyProps {
  selection: ReturnType<typeof useTaskSelection>
}

type Transfer = ReturnType<typeof useDataTransfer>

type DataTab = 'data' | 'admin'

interface DataToolsTabsProps {
  tab: DataTab
  onSelect: (tab: DataTab) => void
  onWrite: () => void
}

/** The task text lookup and reload a daily action needs. */
interface DayContext {
  textOf: (taskId: string) => string
  reloadDay: () => Promise<void>
}

type DailyActions = ReturnType<typeof useDailyActions>

/** Closes the modal on Escape, in the capture phase so no child can stop it first. */
function useEscapeToClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])
}

function useCaptureModal() {
  const { showCaptureModal, setShowCaptureModal, refreshInboxCount } = useVaultStore()
  const [text, setText] = useState('')
  const [capturing, setCapturing] = useState(false)
  const close = useCallback(() => {
    setText('')
    setShowCaptureModal(false)
  }, [setShowCaptureModal])
  useEscapeToClose(showCaptureModal, close)
  async function captureTyped() {
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
  return { show: showCaptureModal, text, setText, capturing, close, capture: captureTyped }
}

export function CaptureModal(): React.JSX.Element | null {
  const modal = useCaptureModal()
  if (!modal.show) return null
  const action = {
    label: modal.capturing ? '…' : 'Capture',
    tone: 'primary' as const,
    disabled: modal.capturing || !modal.text.trim(),
    shortcut: '↵',
    onSelect: () => void modal.capture(),
  }
  return createPortal(
    <Dialog title="Capture to Inbox" onDismiss={modal.close} actions={[action]}>
      <SmartTaskInput
        autoFocus
        value={modal.text}
        onChange={modal.setText}
        onSubmit={modal.capture}
        onCancel={modal.close}
        disabled={modal.capturing}
        placeholder="Task text… @project #area +context due:YYYY-MM-DD"
      />
    </Dialog>,
    document.body
  )
}

/** Saves `data` as a JSON download. */
function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** The import's outcome, as the status line reports it. */
async function importFile(file: File): Promise<string> {
  try {
    const data = JSON.parse(await file.text())
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:import-json',
      data
    )
    if (result && typeof result === 'object' && 'error' in result) {
      return `Import failed: ${(result as { error: string }).error}`
    }
    return `Imported ${(result as { imported: number }).imported} records successfully.`
  } catch (err) {
    return `Import failed: ${String(err)}`
  }
}

/** Exports the vault to a downloaded JSON file; returns the status line to show. */
async function exportVault(): Promise<string> {
  const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:export-json')
  if (result && typeof result === 'object' && 'error' in result) {
    return `Export failed: ${(result as { error: string }).error}`
  }
  downloadJson(result, `task-vault-export-${localDate(new Date())}.json`)
  return 'Exported successfully.'
}

/** Export and import, with a status line for what happened last. */
function useDataTransfer() {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function downloadExport() {
    setExporting(true)
    setStatus(null)
    try {
      setStatus(await exportVault())
    } finally {
      setExporting(false)
    }
  }

  async function importChosen(input: HTMLInputElement) {
    const file = input.files?.[0]
    if (!file) return
    setImporting(true)
    setStatus(null)
    setStatus(await importFile(file))
    setImporting(false)
    input.value = ''
  }
  return { importing, exporting, status, exportJson: downloadExport, importChosen }
}

function StatusLine({ status }: { status: string | null }): React.JSX.Element | null {
  if (!status) return null
  const color = status.includes('failed') ? 'var(--tm-danger)' : 'var(--tm-success)'
  return <p style={{ fontSize: 12, color, margin: 0 }}>{status}</p>
}

const ROW_BUTTON = { display: 'flex', alignItems: 'center', gap: 6 }

function ExportButton({ transfer }: { transfer: Transfer }): React.JSX.Element {
  return (
    <Button
      variant="primary"
      icon={Download}
      onClick={transfer.exportJson}
      disabled={transfer.exporting}
      style={ROW_BUTTON}
    >
      {transfer.exporting ? 'Exporting…' : 'Export JSON'}
    </Button>
  )
}

function TransferButtons({ transfer }: { transfer: Transfer }): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <ExportButton transfer={transfer} />
      <Button
        icon={Upload}
        onClick={() => fileInputRef.current?.click()}
        disabled={transfer.importing}
        style={ROW_BUTTON}
      >
        {transfer.importing ? 'Importing…' : 'Import JSON'}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={(e) => void transfer.importChosen(e.target)}
      />
    </div>
  )
}

function ExportImportPanel(): React.JSX.Element {
  const transfer = useDataTransfer()
  return (
    <div
      className="capture-modal__body"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <p style={{ fontSize: 12, color: 'var(--tm-text-muted)', margin: 0 }}>
        Export everything to JSON for backup or migration. Import merges records by ID — existing
        data is not overwritten.
      </p>
      <TransferButtons transfer={transfer} />
      <StatusLine status={transfer.status} />
    </div>
  )
}

function DataToolsTabs(props: DataToolsTabsProps): React.JSX.Element {
  return (
    <TabsRoot selectedId={props.tab} onSelect={props.onSelect}>
      <TabList label="Data tools">
        <Tab id="data">Export &amp; import</Tab>
        <Tab id="admin">Database</Tab>
      </TabList>
      <TabPanel id="data">
        <ExportImportPanel />
      </TabPanel>
      <TabPanel id="admin">
        <div className="capture-modal__body" style={{ padding: 0 }}>
          <DatabaseAdmin onWrite={props.onWrite} />
        </div>
      </TabPanel>
    </TabsRoot>
  )
}

function DataToolsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { loadToday, refreshInboxCount } = useVaultStore()
  const [tab, setTab] = useState<DataTab>('data')
  const onWrite = () => {
    void loadToday()
    void refreshInboxCount()
  }
  return createPortal(
    <Dialog
      title="Data tools"
      onDismiss={onClose}
      actions={[]}
      size={tab === 'admin' ? 'wide' : 'default'}
    >
      <div className="tv-data-tools" data-wide={tab === 'admin' ? '' : undefined}>
        <DataToolsTabs tab={tab} onSelect={setTab} onWrite={onWrite} />
      </div>
    </Dialog>,
    document.body
  )
}

async function fetchContexts(): Promise<string[] | null> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:kanban:list-contexts'
    )
    if (result && typeof result === 'object' && 'contexts' in result) {
      return (result as { contexts: string[] }).contexts
    }
  } catch {
    // non-critical
  }
  return null
}

/** Reloads the day being viewed: the viewed date, or today. */
function reloadViewedDay(): void {
  const vd = useVaultNavStore.getState().viewingDate
  if (vd) void useVaultDataStore.getState().loadDate(vd)
  else void useVaultDataStore.getState().loadToday()
}

/** Opens the day (or today), then the task, then an explicit view: after the task, because
 *  navigating to a task puts you on the daily log. */
function followNavigation(target: NavigationTarget): void {
  const nav = useVaultNavStore.getState()
  const data = useVaultDataStore.getState()
  nav.setSkipNextVisibilityReset(true)
  if (target.date) void data.loadDate(target.date)
  else void data.loadToday()
  if (target.taskId) nav.navigateToTask(target.taskId, target.date)
  if (target.view) nav.setView(target.view)
}

/** Calendar navigation arrives on `task-vault:navigate`; one sent before this view existed is
 *  popped from main on mount. (The core registry's map is not read: this view bundles a copy.) */
function useNavigationRequests(): void {
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:navigate', (data) => {
      followNavigation((data ?? {}) as NavigationTarget)
    })
  }, [])
  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('task-vault:pop-pending-navigation', null)
      .then((nav) => {
        if (nav && typeof nav === 'object') followNavigation(nav as NavigationTarget)
      })
      .catch(() => {})
  }, [])
}

/** Resets to today when the panel becomes visible from hidden, so "open vault" lands on today;
 *  skipNextVisibilityReset spares a calendar navigation that set the target first. */
function useVisibilityReset(): void {
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const store = useVaultNavStore.getState()
      if (store.skipNextVisibilityReset) return store.setSkipNextVisibilityReset(false)
      store.setView('daily')
      store.setViewingDate(null)
      void useVaultDataStore.getState().loadToday()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])
}

async function loadKanbanLanes(): Promise<void> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:get-config')
    if (result && typeof result === 'object' && !('error' in result)) {
      useVaultDataStore.getState().setKanbanLanes((result as { lanes: KanbanLane[] }).lanes)
    }
  } catch {
    // non-critical
  }
}

/** Loads the day, inbox count, contexts, backlog and lanes, and reloads on vault pushes. */
function useVaultData(setContexts: (contexts: string[]) => void): void {
  useEffect(() => {
    const data = useVaultDataStore.getState()
    const loadContexts = () => void fetchContexts().then((c) => c && setContexts(c))
    reloadViewedDay()
    void data.refreshInboxCount()
    loadContexts()
    void data.loadSomeday()
    void loadKanbanLanes()
    const on = window.electronAPI.extensionBridge.on
    const unsubs = [
      on('task-vault:push:index-updated', () => {
        reloadViewedDay()
        void data.refreshInboxCount()
        loadContexts()
        void data.loadSomeday()
        data.tickCalendar()
      }),
      on('task-vault:push:file-changed-externally', reloadViewedDay),
      on('task-vault:recurrence-spawned', () => {
        data.tickCalendar()
        reloadViewedDay()
      }),
    ]
    return () => unsubs.forEach((unsub) => unsub())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The task in the detail panel: picked by click (again to close) or by a pending navigation. */
function useTaskSelection() {
  const { todayLog, somedayTasks, pendingTaskId, isLoading, clearPendingTask } = useVaultStore()
  const [selected, setSelected] = useState<Selected>({ id: null, text: '' })
  const pendingTask =
    pendingTaskId && todayLog ? todayLog.tasks.find((t) => t.id === pendingTaskId) : undefined
  if (pendingTask && (selected.id !== pendingTask.id || selected.text !== pendingTask.text)) {
    setSelected({ id: pendingTask.id, text: pendingTask.text })
  }
  useEffect(() => {
    if (!pendingTaskId || !todayLog) return
    // Still loading: wait for the right day. Loaded but missing: stale, so clear it.
    if (todayLog.tasks.some((t) => t.id === pendingTaskId) || !isLoading) clearPendingTask()
  }, [pendingTaskId, todayLog, isLoading, clearPendingTask])

  function selectTask(taskId: string | null) {
    if (taskId === null || taskId === selected.id) return setSelected({ id: null, text: '' })
    const task = [...(todayLog?.tasks ?? []), ...somedayTasks].find((t) => t.id === taskId)
    setSelected({ id: taskId, text: task?.text ?? '' })
  }
  useEscapeDeselect(selected.id, () => selectTask(null))
  return { selected, select: selectTask }
}

/** Escape closes the detail panel, unless a suggestion list is open. */
function useEscapeDeselect(selectedId: string | null, deselect: () => void): void {
  useEffect(() => {
    if (!selectedId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.querySelector('.smart-input__dropdown')) deselect()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
}

function shiftDay(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return localDate(d)
}

/** Completes the task, says so with a link back to it, and reloads the day. */
async function completeAndNotify(day: DayContext, taskId: string): Promise<void> {
  const text = day.textOf(taskId)
  await invokeVault('task-vault:vault:complete-task', { taskId })
  notify('success', text ? `Completed: ${text}` : 'Task completed', {
    key: 'taskCompleted',
    onClick: makeTaskNavHandler(taskId),
  })
  await day.reloadDay()
}

/** Migrates the task; a no-op migration says nothing and reloads nothing. */
async function migrateAndNotify(
  day: DayContext,
  taskId: string,
  targetDate: string
): Promise<void> {
  const text = day.textOf(taskId)
  const result = (await invokeVault('task-vault:vault:migrate-task', { taskId, targetDate })) as
    | { noop?: boolean }
    | undefined
  if (result?.noop) return
  notify('info', text ? `Migrated: ${text}` : 'Task migrated', {
    key: 'taskMigrated',
    onClick: makeTaskNavHandler(taskId),
  })
  await day.reloadDay()
}

/** The daily log's actions: complete, migrate, the backlog, and moving between days. */
function useDailyActions() {
  const { todayLog, viewingDate, loadDate, loadToday, loadSomeday } = useVaultStore()
  const textOf = (taskId: string) =>
    (todayLog?.tasks ?? []).find((t) => t.id === taskId)?.text ?? ''
  const day: DayContext = {
    textOf,
    reloadDay: () => (viewingDate ? loadDate(viewingDate) : loadToday()),
  }
  const currentDate = viewingDate ?? localDate(new Date())
  return {
    currentDate,
    isToday: viewingDate === null || viewingDate === localDate(new Date()),
    complete: (taskId: string) => completeAndNotify(day, taskId),
    migrate: (taskId: string, targetDate: string) => migrateAndNotify(day, taskId, targetDate),
    pickUpToday: async (taskId: string) => {
      await invokeVault('task-vault:vault:someday-to-today', { taskId })
      await loadToday()
      await loadSomeday()
    },
    deleteBacklogTask: async (taskId: string) => {
      await invokeVault('task-vault:vault:delete-task', { taskId })
      await loadSomeday()
    },
    prevDay: () => void loadDate(shiftDay(currentDate, -1)),
    nextDay: () => void loadDate(shiftDay(currentDate, 1)),
  }
}

/** Filter label: "Filter", the one context, or how many are chosen. */
function filterLabel(selected: string[]): string {
  if (selected.length === 0) return 'Filter'
  if (selected.length === 1) return `+${selected[0]}`
  return `${selected.length} contexts`
}

function ContextFilterHeader(): React.JSX.Element {
  const { selectedContexts, setSelectedContexts } = useVaultStore()
  return (
    <div className="tv-context-filter__header">
      <span className="tv-context-filter__heading">Filter by context</span>
      {selectedContexts.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setSelectedContexts([])}>
          Clear
        </Button>
      )}
    </div>
  )
}

function ContextOptions({ availableContexts }: { availableContexts: string[] }): React.JSX.Element {
  const { selectedContexts, toggleContext } = useVaultStore()
  return (
    <div className="tv-context-filter__dropdown">
      <ContextFilterHeader />
      {availableContexts.length === 0 && (
        <span className="tv-context-filter__empty">No contexts found</span>
      )}
      {availableContexts.map((ctx) => (
        <label key={ctx} className="tv-context-filter__option">
          <input
            type="checkbox"
            checked={selectedContexts.includes(ctx)}
            onChange={() => toggleContext(ctx)}
            className="tv-context-filter__checkbox"
          />
          <span>{`+${ctx}`}</span>
        </label>
      ))}
    </div>
  )
}

/** The context filter; its ref wraps the trigger too, so clicking it to close does not reopen. */
function ContextFilter({ availableContexts }: { availableContexts: string[] }): React.JSX.Element {
  const { selectedContexts } = useVaultStore()
  const [open, setOpen] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  useDismissible({
    ref: contextMenuRef,
    onDismiss: () => setOpen(false),
    manageFocus: false,
    enabled: open,
  })
  return (
    <div className="tv-context-filter" ref={contextMenuRef}>
      <Button
        aria-label="Filter by context"
        variant={selectedContexts.length > 0 ? 'secondary' : 'ghost'}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        title="Filter"
      >
        {filterLabel(selectedContexts)}
        <ChevronDown className="tm-icon-sm" />
      </Button>
      {open && <ContextOptions availableContexts={availableContexts} />}
    </div>
  )
}

function ViewModeToggles(): React.JSX.Element {
  const { viewMode, setViewMode } = useVaultStore()
  return (
    <>
      <IconButton
        icon={List}
        label="List view"
        pressed={viewMode === 'list'}
        onClick={() => setViewMode('list')}
      />
      <IconButton
        icon={Kanban}
        label="Board view"
        pressed={viewMode === 'kanban'}
        onClick={() => setViewMode('kanban')}
      />
    </>
  )
}

/** Every view toggle is an IconButton, whose label is required: the toggles once carried `title`
 *  alone, and a tooltip is not a label and never appears for keyboard or touch. */
function VaultToolbar(props: ToolbarProps): React.JSX.Element {
  const { activeView } = useVaultStore()
  return (
    <div className="task-vault-view__toolbar-row">
      <div className="task-vault-view__toolbar">
        <div className="task-vault-view__toolbar-right">
          <ViewModeToggles />
          <ContextFilter availableContexts={props.availableContexts} />
          {activeView === 'daily' && (
            <IconButton
              icon={CalendarDays}
              label="Calendar"
              pressed={props.showCalendar}
              className="task-vault-view__tools-btn"
              onClick={props.onToggleCalendar}
            />
          )}
          <IconButton
            icon={Settings}
            label="Data tools (export / import)"
            className="task-vault-view__tools-btn"
            onClick={props.onDataTools}
          />
        </div>
      </div>
    </div>
  )
}

/** No log yet: the loading line, and any load error under it. */
function LoadingDay(props: { error: string | null }): React.JSX.Element {
  return (
    <>
      <div className="task-vault-view__loading">Loading…</div>
      {props.error && <div className="task-vault-view__error">{props.error}</div>}
    </>
  )
}

/** Today reloads the log and the backlog; another day reloads just that day. */
function dayRefresh(store: ReturnType<typeof useVaultStore>, actions: DailyActions) {
  if (!actions.isToday) return () => store.loadDate(actions.currentDate)
  return async () => {
    await store.loadToday()
    await store.loadSomeday()
  }
}

function DailyArea({ selection }: DailyProps): React.JSX.Element {
  const store = useVaultStore()
  const { todayLog, error } = store
  const actions = useDailyActions()
  if (!todayLog) return <LoadingDay error={error} />
  if (error) return <div className="task-vault-view__error">{error}</div>
  return (
    <DailyLog
      log={todayLog}
      rolledOverTaskIds={store.rolledOverTaskIds}
      selectedContexts={store.selectedContexts}
      selectedTaskId={selection.selected.id}
      onSelectTask={selection.select}
      onTaskComplete={actions.complete}
      onTaskMigrate={actions.migrate}
      onRefresh={dayRefresh(store, actions)}
      onPrevDay={actions.prevDay}
      onNextDay={actions.nextDay}
      onGoToToday={store.loadToday}
      isToday={actions.isToday}
      somedayTasks={store.somedayTasks}
      onPickUpToday={actions.pickUpToday}
      onDeleteBacklogTask={actions.deleteBacklogTask}
      onRefreshBacklog={store.loadSomeday}
      staleDaysThreshold={store.staleDaysThreshold}
    />
  )
}

const OTHER_VIEWS: Partial<Record<VaultView, () => React.JSX.Element>> = {
  inbox: InboxView,
  projects: ProjectsBrowser,
  areas: AreasView,
  archive: ArchiveView,
  review: WeeklyReview,
}

function DetailPane({ selection }: DailyProps): React.JSX.Element | null {
  const { id, text } = selection.selected
  if (!id) return null
  return (
    <>
      <div className="tv-detail-panel__backdrop" onClick={() => selection.select(null)} />
      <TaskDetailPanel taskId={id} taskText={text} onClose={() => selection.select(null)} />
    </>
  )
}

function MainPanel({ selection, showCalendar }: DailyProps & { showCalendar: boolean }) {
  const { activeView } = useVaultStore()
  const Other = OTHER_VIEWS[activeView]
  return (
    <div className="task-vault-view__main">
      <div className="task-vault-view__list">
        {activeView === 'daily' && <DailyArea selection={selection} />}
        {Other && <Other />}
      </div>
      {activeView === 'daily' && <DetailPane selection={selection} />}
      {activeView === 'daily' && showCalendar && <CalendarDrawer />}
    </div>
  )
}

export function TaskVaultView(): React.JSX.Element {
  const { viewMode, activeView } = useVaultStore()
  const [showDataTools, setShowDataTools] = useState(false)
  const [showCalendar, setShowCalendar] = useState(true)
  const [availableContexts, setAvailableContexts] = useState<string[]>([])
  const selection = useTaskSelection()
  useVisibilityReset()
  useNavigationRequests()
  useVaultData(setAvailableContexts)
  return (
    <div className="task-vault-view">
      {showDataTools && <DataToolsModal onClose={() => setShowDataTools(false)} />}
      <VaultSidebar />
      <div className="task-vault-view__content">
        <VaultToolbar
          availableContexts={availableContexts}
          showCalendar={showCalendar}
          onToggleCalendar={() => setShowCalendar((v) => !v)}
          onDataTools={() => setShowDataTools(true)}
        />
        {viewMode === 'kanban' && activeView !== 'review' ? (
          <KanbanBoard />
        ) : (
          <MainPanel selection={selection} showCalendar={showCalendar} />
        )}
      </div>
    </div>
  )
}
