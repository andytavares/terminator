import React, { useCallback, useEffect, useState } from 'react'
import { Settings, Ticket, Layout, History } from 'lucide-react'
import { TicketsView } from '../components/TicketsView.js'
import { FeaturesView } from '../components/FeaturesView.js'
import { HistoryView } from '../components/HistoryView.js'
import { SettingsView } from '../components/SettingsView.js'
import { RunDashboard } from '../components/RunDashboard.js'
import { ActiveRunsView } from '../components/ActiveRunsView.js'
import { getSpeckitAPI } from '../types/electron.js'
import type { PilotState } from '../types/speckit.types.js'

type Tab = 'tickets' | 'features' | 'runs' | 'history' | 'settings'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'tickets', label: 'Tickets', icon: <Ticket size={14} /> },
  { id: 'features', label: 'Features', icon: <Layout size={14} /> },
  { id: 'runs', label: 'Active runs', icon: null },
  { id: 'history', label: 'History', icon: <History size={14} /> },
]

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [activeTab, setActiveTab] = useState<Tab>('tickets')
  // All feature dirs with an active/in-progress run in this workspace
  const [activeRunDirs, setActiveRunDirs] = useState<string[]>([])
  // Which one the user is currently drilling into
  const [selectedRunDir, setSelectedRunDir] = useState<string | null>(null)

  // On mount (or when repoRoot arrives), reconnect to any runs that were active
  useEffect(() => {
    if (!repoRoot) return
    const api = getSpeckitAPI()
    void (async () => {
      const listResult = await api.featureList({ repoRoot })
      if (!('features' in listResult)) return
      const dirs: string[] = []
      for (const feature of listResult.features) {
        const stateResult = await api.pilotState({ featureDir: feature.dir })
        if ('state' in stateResult && stateResult.state.run?.status === 'running') {
          dirs.push(feature.dir)
        }
      }
      if (dirs.length > 0) {
        setActiveRunDirs(dirs)
        setActiveTab('runs')
      }
    })()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for state changes to remove completed/failed/cancelled runs from the list
  useEffect(() => {
    const api = getSpeckitAPI()
    const unsub = api.onStateChanged((data) => {
      const payload = data as { state?: PilotState }
      if (!payload.state) return
      const { featureDir, run } = payload.state
      const done =
        run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled'
      if (done) {
        setActiveRunDirs((prev) => prev.filter((d) => d !== featureDir))
        setSelectedRunDir((prev) => (prev === featureDir ? null : prev))
      }
    })
    return unsub
  }, [])

  // Workspace switch
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
      setActiveRunDirs([])
      setSelectedRunDir(null)
    })
  }, [])

  // New dispatch started
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('speckit:dispatch-started', (data: unknown) => {
      const d = data as { featureDir?: string; branchName?: string; worktreePath?: string }
      if (d.featureDir) {
        setActiveRunDirs((prev) => (prev.includes(d.featureDir!) ? prev : [...prev, d.featureDir!]))
        setSelectedRunDir(d.featureDir)
        setActiveTab('runs')
      }
      if (d.worktreePath && d.branchName) {
        void createWorktreeProject(d.branchName, d.worktreePath)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createWorktreeProject(branchName: string, worktreePath: string) {
    try {
      if (!repoRoot) return
      const listResult = (await window.electronAPI.workspace.list()) as {
        workspaces: Array<{ id: string; folderPath: string }>
      }
      const workspace = listResult.workspaces.find((w) => w.folderPath === repoRoot)
      if (!workspace) return
      await window.electronAPI.project.create({
        workspaceId: workspace.id,
        name: branchName,
        gitBranch: branchName,
        worktreePath,
        isWorktree: true,
      })
    } catch {
      // non-critical — workspace project creation failing should not block the run
    }
  }

  const handleFeatureSelect = useCallback((featureDir: string) => {
    setSelectedRunDir(featureDir)
    setActiveTab('runs')
  }, [])

  const workspacePath = repoRoot ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Sub-nav */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 8px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          background: 'var(--tm-bg-surface)',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            aria-label={tab.label}
            className={`sk-tab${activeTab === tab.id ? ' sk-tab--active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id)
              // Returning to the runs tab from elsewhere should show the list, not the last selected run
              if (tab.id === 'runs') setSelectedRunDir(null)
            }}
          >
            {tab.icon}
            <span className="sk-tab__label">{tab.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          aria-label="Settings"
          className={`sk-tab${activeTab === 'settings' ? ' sk-tab--active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'tickets' && <TicketsView workspacePath={workspacePath} />}
        {activeTab === 'features' && (
          <FeaturesView workspacePath={workspacePath} onSelect={handleFeatureSelect} />
        )}
        {activeTab === 'runs' && selectedRunDir ? (
          <RunDashboard
            featureDir={selectedRunDir}
            workspacePath={workspacePath}
            onBack={() => setSelectedRunDir(null)}
          />
        ) : activeTab === 'runs' ? (
          <ActiveRunsView
            activeRunDirs={activeRunDirs}
            workspacePath={workspacePath}
            onSelect={(dir) => setSelectedRunDir(dir)}
          />
        ) : null}
        {activeTab === 'history' && <HistoryView workspacePath={workspacePath} />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}
