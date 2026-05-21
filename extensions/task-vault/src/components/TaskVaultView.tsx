import React, { useEffect, useState, useCallback } from 'react'
import { X } from 'lucide-react'
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
          <button className="capture-modal__close" onClick={close}><X size={14} /></button>
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

export function TaskVaultView(): React.JSX.Element {
  const { todayLog, activeView, isLoading, error, loadToday, refreshInboxCount } = useVaultStore()

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
      <VaultSidebar />
      <div className="task-vault-view__content">
        {activeView === 'daily' && isLoading && (
          <div className="task-vault-view__loading">Loading…</div>
        )}
        {activeView === 'daily' && error && (
          <div className="task-vault-view__error">{error}</div>
        )}
        {activeView === 'daily' && !isLoading && !error && todayLog && (
          <DailyLog
            log={todayLog}
            onTaskComplete={handleComplete}
            onTaskMigrate={handleMigrate}
            onRefresh={loadToday}
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
    </div>
  )
}
