import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, Settings, Download, Upload } from 'lucide-react'
import { createPortal } from 'react-dom'
import './task-vault.css'
import { useVaultStore } from '../stores/vault.store'
import { VaultSidebar } from './VaultSidebar'
import { DailyLog } from './DailyLog'
import { ProjectsBrowser } from './ProjectsBrowser'
import { WeeklyReview } from './WeeklyReview'
import { InboxView } from './InboxView'
import { AreasView } from './AreasView'
import { ArchiveView } from './ArchiveView'
import { SmartTaskInput } from './SmartTaskInput'

function CaptureModal(): React.JSX.Element | null {
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
      a.download = `task-vault-export-${new Date().toISOString().slice(0, 10)}.json`
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
      <div className="capture-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="capture-modal__header">
          <span className="capture-modal__title">Data Tools</span>
          <button className="capture-modal__close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
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
      </div>
    </div>,
    document.body
  )
}

export function TaskVaultView(): React.JSX.Element {
  const { todayLog, activeView, isLoading, error, loadToday, refreshInboxCount, lastRolledOver } =
    useVaultStore()
  const [showDataTools, setShowDataTools] = useState(false)

  useEffect(() => {
    loadToday()
    refreshInboxCount()

    const unsubIndexUpdated = window.electronAPI.extensionBridge.on(
      'task-vault:push:index-updated',
      () => {
        loadToday()
        refreshInboxCount()
      }
    )

    const unsubExternal = window.electronAPI.extensionBridge.on(
      'task-vault:push:file-changed-externally',
      () => {
        loadToday()
      }
    )

    return () => {
      unsubIndexUpdated()
      unsubExternal()
    }
  }, [])

  async function handleComplete(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', { taskId })
    await loadToday()
  }

  async function handleMigrate(taskId: string, targetDate: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:migrate-task', {
      taskId,
      targetDate,
    })
    await loadToday()
  }

  return (
    <div className="task-vault-view">
      <CaptureModal />
      {showDataTools && <DataToolsModal onClose={() => setShowDataTools(false)} />}
      <VaultSidebar />
      <div className="task-vault-view__content">
        <div className="task-vault-view__toolbar">
          <button
            className="tv-btn tv-btn--ghost task-vault-view__tools-btn"
            onClick={() => setShowDataTools(true)}
            title="Data tools (export / import)"
          >
            <Settings size={14} />
          </button>
        </div>
        {activeView === 'daily' && isLoading && (
          <div className="task-vault-view__loading">Loading…</div>
        )}
        {activeView === 'daily' && error && <div className="task-vault-view__error">{error}</div>}
        {activeView === 'daily' && !isLoading && !error && todayLog && (
          <>
            {lastRolledOver > 0 && (
              <div className="task-vault-view__rollover-banner">
                {lastRolledOver} unfinished task{lastRolledOver !== 1 ? 's' : ''} carried forward
                from previous days
              </div>
            )}
            <DailyLog
              log={todayLog}
              onTaskComplete={handleComplete}
              onTaskMigrate={handleMigrate}
              onRefresh={loadToday}
            />
          </>
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
    </div>
  )
}
