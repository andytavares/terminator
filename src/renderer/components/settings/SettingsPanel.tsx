import React, { useState, useEffect } from 'react'
import { GlobalSettings } from './GlobalSettings'
import { WorkspaceSettings } from './WorkspaceSettings'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './SettingsPanel.css'

type Section = 'global' | 'workspace' | 'extensions'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props): JSX.Element {
  const [section, setSection] = useState<Section>('global')
  const { activeWorkspaceId } = useWorkspaceStore()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__sidebar">
          <h2 className="settings-panel__title">Settings</h2>
          <nav className="settings-panel__nav">
            <button
              className={`settings-panel__nav-item${section === 'global' ? ' settings-panel__nav-item--active' : ''}`}
              onClick={() => setSection('global')}
            >
              Appearance & Terminal
            </button>
            {activeWorkspaceId && (
              <button
                className={`settings-panel__nav-item${section === 'workspace' ? ' settings-panel__nav-item--active' : ''}`}
                onClick={() => setSection('workspace')}
              >
                Workspace Settings
              </button>
            )}
            <button
              className={`settings-panel__nav-item${section === 'extensions' ? ' settings-panel__nav-item--active' : ''}`}
              onClick={() => setSection('extensions')}
            >
              Extensions
            </button>
          </nav>
        </div>
        <div className="settings-panel__content">
          <button className="settings-panel__close" onClick={onClose}>
            ✕
          </button>
          {section === 'global' && <GlobalSettings />}
          {section === 'workspace' && activeWorkspaceId && (
            <WorkspaceSettings workspaceId={activeWorkspaceId} />
          )}
          {section === 'extensions' && <ExtensionsSection />}
        </div>
      </div>
    </div>
  )
}

function ExtensionsSection(): JSX.Element {
  const [extensions, setExtensions] = React.useState<
    Array<{ id: string; name: string; version: string; status: string }>
  >([])

  React.useEffect(() => {
    window.electronAPI.extension.list().then((r) => setExtensions(r.extensions ?? []))
  }, [])

  async function handleInstall(): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('cancelled' in result) return
    const installResult = await window.electronAPI.extension.install(result.filePath)
    if ('extension' in installResult) {
      setExtensions((prev) => [...prev, installResult.extension])
    } else {
      alert(`Failed to install extension: ${installResult.error}`)
    }
  }

  async function handleToggle(id: string, currentStatus: string): Promise<void> {
    const enabled = currentStatus !== 'enabled'
    const result = await window.electronAPI.extension.toggle(id, enabled)
    if ('extension' in result) {
      setExtensions((prev) => prev.map((e) => (e.id === id ? result.extension : e)))
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Extensions</h3>
      <button className="settings-section__btn" onClick={handleInstall}>
        Install from Directory
      </button>
      {extensions.length === 0 && (
        <p className="settings-section__empty">No extensions installed.</p>
      )}
      {extensions.map((ext) => (
        <div key={ext.id} className="extension-item">
          <div className="extension-item__info">
            <span className="extension-item__name">{ext.name}</span>
            <span className="extension-item__version">v{ext.version}</span>
            <span className={`extension-item__status extension-item__status--${ext.status}`}>
              {ext.status}
            </span>
          </div>
          <button
            className="settings-section__btn"
            onClick={() => handleToggle(ext.id, ext.status)}
          >
            {ext.status === 'enabled' ? 'Disable' : 'Enable'}
          </button>
        </div>
      ))}
    </div>
  )
}
