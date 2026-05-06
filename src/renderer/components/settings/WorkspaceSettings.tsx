import React, { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './SettingsPanel.css'

interface Props {
  workspaceId: string
}

export function WorkspaceSettings({ workspaceId }: Props): JSX.Element {
  const {
    workspaceSettings,
    globalSettings,
    updateWorkspaceTheme,
    updateWorkspaceScrollback,
    updateWorkspaceWorktreeBaseDir,
    loadSettings,
  } = useSettingsStore()
  const { workspaces } = useWorkspaceStore()

  const workspace = workspaces.find((w) => w.id === workspaceId)
  const ws = workspaceSettings.get(workspaceId)

  useEffect(() => {
    loadSettings(workspaceId)
  }, [workspaceId])

  if (!globalSettings) return <div>Loading...</div>

  const effectiveTheme = ws?.overrides?.appearance?.theme ?? globalSettings.appearance.theme
  const effectiveScrollback =
    ws?.overrides?.terminal?.scrollbackLimit ?? globalSettings.terminal.scrollbackLimit
  const hasWorktreeDirOverride = ws?.overrides?.git?.worktreeBaseDir !== undefined
  const effectiveWorktreeBaseDir =
    ws?.overrides?.git?.worktreeBaseDir ?? globalSettings.git.worktreeBaseDir

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Settings for: {workspace?.name ?? workspaceId}</h3>
      <p className="settings-section__desc">Override global defaults for this workspace.</p>

      <div className="settings-section__field">
        <label className="settings-section__label">Theme</label>
        <div className="settings-section__radio-group">
          {(['dark', 'light'] as const).map((t) => (
            <label key={t} className="settings-section__radio">
              <input
                type="radio"
                value={t}
                checked={effectiveTheme === t}
                onChange={() => updateWorkspaceTheme(workspaceId, t)}
              />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
          <label className="settings-section__radio">
            <input
              type="radio"
              checked={!ws?.overrides?.appearance?.theme}
              onChange={() =>
                window.electronAPI.settings.updateWorkspace(workspaceId, {
                  appearance: undefined,
                })
              }
            />
            Use global default
          </label>
        </div>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Scrollback Limit</label>
        <input
          type="number"
          className="settings-section__input"
          value={effectiveScrollback}
          min={1000}
          max={100000}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1000 && val <= 100000) updateWorkspaceScrollback(workspaceId, val)
          }}
        />
        <button
          className="settings-section__btn-link"
          onClick={() =>
            window.electronAPI.settings.updateWorkspace(workspaceId, { terminal: undefined })
          }
        >
          Use global default
        </button>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>Git</h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Worktree Base Directory</label>
        <input
          type="text"
          className="settings-section__input"
          key={effectiveWorktreeBaseDir}
          defaultValue={effectiveWorktreeBaseDir}
          placeholder="Leave empty to use <repo>/.worktrees"
          onBlur={(e) => updateWorkspaceWorktreeBaseDir(workspaceId, e.target.value.trim() || undefined)}
        />
        <span className="settings-section__hint">
          Overrides the global setting for this workspace.
        </span>
        {hasWorktreeDirOverride && (
          <button
            className="settings-section__btn-link"
            onClick={() => updateWorkspaceWorktreeBaseDir(workspaceId, undefined)}
          >
            Use global default
          </button>
        )}
      </div>
    </div>
  )
}
