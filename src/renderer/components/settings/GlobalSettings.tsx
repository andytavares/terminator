import React from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import './SettingsPanel.css'

export function GlobalSettings(): JSX.Element {
  const {
    globalSettings,
    updateGlobalTheme,
    updateScrollbackLimit,
    updateWorktreeBaseDir,
    updateBranchExcludePatterns,
    updateShowMetricsBar,
  } = useSettingsStore()

  if (!globalSettings) return <div>Loading...</div>

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Appearance</h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Theme</label>
        <div className="settings-section__radio-group">
          {(['dark', 'light'] as const).map((t) => (
            <label key={t} className="settings-section__radio">
              <input
                type="radio"
                value={t}
                checked={globalSettings.appearance.theme === t}
                onChange={() => updateGlobalTheme(t)}
              />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Terminal
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Scrollback Limit (1,000–100,000 lines)</label>
        <input
          type="number"
          className="settings-section__input"
          value={globalSettings.terminal.scrollbackLimit}
          min={1000}
          max={100000}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1000 && val <= 100000) updateScrollbackLimit(val)
          }}
        />
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Default Shell</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={globalSettings.terminal.defaultShell}
          onBlur={(e) => {
            const val = e.target.value.trim()
            if (val) {
              window.electronAPI.settings.updateGlobal({ terminal: { defaultShell: val } })
            }
          }}
        />
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Interface
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label settings-section__label--inline">
          <input
            type="checkbox"
            checked={globalSettings.ui?.showMetricsBar ?? false}
            onChange={(e) => void updateShowMetricsBar(e.target.checked)}
          />
          Show CPU / Memory / Network bar
        </label>
        <span className="settings-section__hint">
          Displays a system metrics bar at the bottom of every screen.
        </span>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Git
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Worktree Base Directory</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={globalSettings.git.worktreeBaseDir}
          placeholder="Leave empty to use <repo>/.worktrees"
          onBlur={(e) => updateWorktreeBaseDir(e.target.value.trim())}
        />
        <span className="settings-section__hint">
          Where new git worktrees are created. Leave empty for the default (<code>.worktrees</code>{' '}
          inside the repo).
        </span>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Branch Exclude Patterns</label>
        <textarea
          className="settings-section__input settings-section__textarea"
          defaultValue={(globalSettings.git.branchExcludePatterns ?? []).join('\n')}
          placeholder={'gh-readonly-queue/*\nrenovate/*'}
          rows={4}
          onBlur={(e) => {
            const patterns = e.target.value
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean)
            void updateBranchExcludePatterns(patterns)
          }}
        />
        <span className="settings-section__hint">
          One pattern per line. Supports <code>*</code> wildcards (e.g.{' '}
          <code>gh-readonly-queue/*</code>). Matching branches are hidden from the branch selector.
        </span>
      </div>
    </div>
  )
}
