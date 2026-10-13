import React, { useState, useEffect, useRef } from 'react'
import { GlobalSettings } from './GlobalSettings'
import { IntegrationsSettings } from './IntegrationsSettings'
import { WorkspaceSettings } from './WorkspaceSettings'
import { ExtensionsSection } from './ExtensionsSection'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useModalEffect } from '../../stores/modal.store'
import '@terminator/extension-ui/settings-fields.css'
import './SettingsPanel.css'

type Section = 'global' | 'workspace' | 'integrations' | 'extensions'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props): JSX.Element {
  useModalEffect()
  const [section, setSection] = useState<Section>('global')
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const panelRef = usePanelFocus()
  useEscapeToClose(onClose)

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__sidebar">
          <h2 className="settings-panel__title">Settings</h2>
          <SettingsNav section={section} onSelect={setSection} hasWorkspace={!!activeWorkspaceId} />
        </div>
        <div className="settings-panel__content">
          <button className="settings-panel__close" onClick={onClose}>
            ✕
          </button>
          <SectionContent section={section} workspaceId={activeWorkspaceId} />
        </div>
      </div>
    </div>
  )
}

/** The terminal's xterm stops Escape from propagating, so the panel takes focus as it opens. */
function usePanelFocus() {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panelRef.current?.focus()
  }, [])
  return panelRef
}

function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}

const SECTIONS: Array<{ section: Section; label: string }> = [
  { section: 'global', label: 'Appearance & Terminal' },
  { section: 'workspace', label: 'Workspace Settings' },
  { section: 'integrations', label: 'Integrations' },
  { section: 'extensions', label: 'Extensions' },
]

interface NavProps {
  section: Section
  onSelect: (section: Section) => void
  /** Workspace Settings is offered only while a workspace is active. */
  hasWorkspace: boolean
}

function SettingsNav({ section, onSelect, hasWorkspace }: NavProps): JSX.Element {
  const offered = SECTIONS.filter((s) => s.section !== 'workspace' || hasWorkspace)
  return (
    <nav className="settings-panel__nav">
      {offered.map(({ section: value, label }) => (
        <button
          key={value}
          className={`settings-panel__nav-item${section === value ? ' settings-panel__nav-item--active' : ''}`}
          onClick={() => onSelect(value)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

function SectionContent({
  section,
  workspaceId,
}: {
  section: Section
  workspaceId: string | null
}) {
  switch (section) {
    case 'global':
      return <GlobalSettings />
    case 'workspace':
      return workspaceId ? <WorkspaceSettings workspaceId={workspaceId} /> : null
    case 'integrations':
      return <IntegrationsSettings />
    case 'extensions':
      return <ExtensionsSection />
  }
}
