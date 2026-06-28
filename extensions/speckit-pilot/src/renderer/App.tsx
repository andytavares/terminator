import React, { useEffect, useState } from 'react'
import { Settings, Ticket, Layout, History } from 'lucide-react'
import { TicketsView } from '../components/TicketsView.js'
import { FeaturesView } from '../components/FeaturesView.js'
import { HistoryView } from '../components/HistoryView.js'
import { SettingsView } from '../components/SettingsView.js'
import { RunDashboard } from '../components/RunDashboard.js'

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
  const [activeRunDir, setActiveRunDir] = useState<string | null>(null)

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('speckit:dispatch-started', (data: unknown) => {
      const d = data as { featureDir?: string }
      if (d.featureDir) {
        setActiveRunDir(d.featureDir)
        setActiveTab('runs')
      }
    })
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
            onClick={() => setActiveTab(tab.id)}
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
        {activeTab === 'features' && <FeaturesView workspacePath={workspacePath} />}
        {activeTab === 'runs' && activeRunDir && (
          <RunDashboard featureDir={activeRunDir} workspacePath={workspacePath} />
        )}
        {activeTab === 'runs' && !activeRunDir && (
          <div className="sk-empty">
            <div className="sk-empty__title">No active run</div>
            <div className="sk-empty__sub">
              Dispatch a ticket from the Tickets tab to start one.
            </div>
          </div>
        )}
        {activeTab === 'history' && <HistoryView workspacePath={workspacePath} />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}
