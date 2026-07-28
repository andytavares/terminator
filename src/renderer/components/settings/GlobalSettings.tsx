import React from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import type { NotificationTarget } from '../../../shared/types/index'
import './SettingsPanel.css'

const NOTIFICATION_TARGETS: Array<{ value: NotificationTarget; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'center', label: 'In-App' },
  { value: 'toast', label: 'Toast' },
]

// Core's own notification kinds only. Each extension's notification settings
// live entirely in that extension's own settings panel (registered via
// api.settings.register) — core has no knowledge of what notifications any
// extension defines, so nothing extension-specific is listed here.
const CORE_NOTIFICATION_KEYS: Array<{ key: string; label: string }> = [
  { key: 'terminalBell', label: 'Terminal bell (session needs attention)' },
  { key: 'branchSwitchFailed', label: 'Branch switch failed' },
  { key: 'splitPaneFailed', label: 'Split pane failed' },
  { key: 'closeTerminalFailed', label: 'Close terminal failed' },
  { key: 'remoteTunnelDisconnected', label: 'Remote tunnel disconnected' },
  { key: 'extensionInstalled', label: 'Extension installed' },
  { key: 'extensionInstallFailed', label: 'Extension install failed' },
  { key: 'extensionReloaded', label: 'Extension reloaded' },
  { key: 'extensionReloadFailed', label: 'Extension reload failed' },
  { key: 'extensionUninstalled', label: 'Extension uninstalled' },
  { key: 'extensionUninstallFailed', label: 'Extension uninstall failed' },
  { key: 'extensionUpgraded', label: 'Extension upgraded' },
  { key: 'extensionUpgradeFailed', label: 'Extension upgrade failed' },
  { key: 'extensionSettingAction', label: 'Extension setting action result' },
]

export function GlobalSettings(): JSX.Element {
  const {
    globalSettings,
    updateGlobalTheme,
    updateScrollbackLimit,
    updateWorktreeBaseDir,
    updateBranchExcludePatterns,
    updateExternalEditor,
    updateLinearApiKey,
    updateShowMetricsBar,
    updatePromptForName,
    updateNotificationDefaultTargets,
    updateNotificationOverride,
  } = useSettingsStore()

  if (!globalSettings) return <div>Loading...</div>

  function toggleTarget(
    current: NotificationTarget[],
    target: NotificationTarget
  ): NotificationTarget[] {
    return current.includes(target) ? current.filter((t) => t !== target) : [...current, target]
  }

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

      <div className="settings-section__field">
        <label className="settings-section__label settings-section__label--inline">
          <input
            type="checkbox"
            checked={globalSettings.terminal.promptForName ?? false}
            onChange={(e) => void updatePromptForName(e.target.checked)}
          />
          Prompt for session name on creation
        </label>
        <span className="settings-section__hint">
          When enabled, you are asked to name each new terminal before it opens. Leave blank to use
          the default &ldquo;Terminal N&rdquo; name.
        </span>
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
        Supervision
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">External Editor Command</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={globalSettings.supervision?.externalEditor ?? ''}
          placeholder="code"
          onBlur={(e) => void updateExternalEditor(e.target.value.trim())}
        />
        <span className="settings-section__hint">
          Run against a session&rsquo;s working copy by &ldquo;Open in editor&rdquo;. Handing off to
          an editor is a first-class action, not a gap — but with nothing set here the button can
          only tell you it is unconfigured.
        </span>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Linear API Key</label>
        <input
          type="password"
          className="settings-section__input"
          defaultValue={globalSettings.supervision?.linearApiKey ?? ''}
          placeholder="lin_api_…"
          onBlur={(e) => void updateLinearApiKey(e.target.value.trim())}
        />
        <span className="settings-section__hint">
          A personal API key, used to pull the issues assigned to you into Work items. Read only —
          the console never writes back to Linear. Stored in this app&rsquo;s settings file, not in
          the system keychain.
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

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Notifications
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Default Delivery Targets</label>
        <div className="settings-section__radio-group">
          {NOTIFICATION_TARGETS.map(({ value, label }) => (
            <label key={value} className="settings-section__radio">
              <input
                type="checkbox"
                checked={globalSettings.notifications.defaultTargets.includes(value)}
                onChange={() =>
                  void updateNotificationDefaultTargets(
                    toggleTarget(globalSettings.notifications.defaultTargets, value)
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <span className="settings-section__hint">
          Where notifications are delivered by default. Errors always show a toast regardless of
          this setting.
        </span>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Per-Notification Overrides (Core)</label>
        {CORE_NOTIFICATION_KEYS.map(({ key, label }) => {
          const override = globalSettings.notifications.overrides[key] ?? []
          return (
            <div key={key} className="settings-section__ext-override-row">
              <span className="settings-section__ext-override-name">{label}</span>
              <div className="settings-section__radio-group">
                {NOTIFICATION_TARGETS.map(({ value, label: targetLabel }) => (
                  <label key={value} className="settings-section__radio">
                    <input
                      type="checkbox"
                      checked={override.includes(value)}
                      onChange={() =>
                        void updateNotificationOverride(key, toggleTarget(override, value))
                      }
                    />
                    {targetLabel}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
        <span className="settings-section__hint">
          Leave all unchecked for a notification to use the default targets above. Each
          extension&rsquo;s own notifications are configured in that extension&rsquo;s settings
          panel, not here.
        </span>
      </div>
    </div>
  )
}
