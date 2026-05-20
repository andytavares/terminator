import React, { useEffect } from 'react'
import { useVaultStore } from '../stores/vault.store'
import { VaultSidebar } from './VaultSidebar'
import { DailyLog } from './DailyLog'
import { ProjectsBrowser } from './ProjectsBrowser'
import { WeeklyReview } from './WeeklyReview'

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
      <VaultSidebar />
      <div className="task-vault-view__content">
        {isLoading && <div className="task-vault-view__loading">Loading…</div>}
        {error && <div className="task-vault-view__error">{error}</div>}
        {!isLoading && !error && activeView === 'daily' && todayLog && (
          <DailyLog log={todayLog} onTaskComplete={handleComplete} onTaskMigrate={handleMigrate} />
        )}
        {!isLoading && !error && activeView === 'daily' && !todayLog && (
          <div className="task-vault-view__empty">
            No vault configured. Set vault path in settings.
          </div>
        )}
        {activeView === 'inbox' && (
          <div className="task-vault-view__placeholder">Inbox view — coming soon</div>
        )}
        {activeView === 'projects' && <ProjectsBrowser />}
        {activeView === 'areas' && (
          <div className="task-vault-view__placeholder">Areas view — coming soon</div>
        )}
        {activeView === 'archive' && (
          <div className="task-vault-view__placeholder">Archive view — coming soon</div>
        )}
        {activeView === 'review' && <WeeklyReview />}
      </div>
    </div>
  )
}
