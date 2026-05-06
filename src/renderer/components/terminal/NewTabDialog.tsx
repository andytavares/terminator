import React, { useState } from 'react'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import '../sidebar/Dialog.css'

interface Props {
  projectId: string
  onClose: () => void
}

export function NewTabDialog({ projectId, onClose }: Props): JSX.Element {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<'human' | 'agent'>('human')
  const { createSession } = useTerminalSession()
  const { workspaces, activeWorkspaceId, projectsByWorkspaceId } = useWorkspaceStore()
  const { resolveSettings } = useSettingsStore()

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const project = projects.find((p) => p.id === projectId)
    const cwd = project?.worktreePath ?? workspace?.folderPath ?? '~'
    const settings = resolveSettings(activeWorkspaceId)
    await createSession(
      projectId,
      type,
      title.trim() || (type === 'agent' ? 'Agent' : 'Terminal'),
      cwd,
      settings.terminal.scrollbackLimit
    )
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">New Tab</h2>
        <form onSubmit={handleSubmit}>
          <div className="dialog__field">
            <label className="dialog__label">Title (optional)</label>
            <input
              className="dialog__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Terminal"
              autoFocus
            />
          </div>

          <div className="dialog__field">
            <label className="dialog__label">Session Type</label>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="human"
                  checked={type === 'human'}
                  onChange={() => setType('human')}
                />
                Human
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="agent"
                  checked={type === 'agent'}
                  onChange={() => setType('agent')}
                />
                Agent
              </label>
            </div>
          </div>

          <div className="dialog__actions">
            <button type="button" className="dialog__btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dialog__btn-primary">
              Open
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
