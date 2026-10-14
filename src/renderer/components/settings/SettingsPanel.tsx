import React, { useState } from 'react'
import { ModalShell } from '@terminator/extension-ui'
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

  return (
    <ModalShell label="Settings" className="settings-panel" onDismiss={onClose}>
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
    </ModalShell>
  )
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
