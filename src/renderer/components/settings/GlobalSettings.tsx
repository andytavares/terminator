import React from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import type {
  GlobalSettings as GlobalSettingsValue,
  NotificationTarget,
} from '../../../shared/types/index'
import type { HomeLayout } from '../../../shared/schemas/settings.schema'
import { parsePatterns, PATTERNS_PLACEHOLDER } from './patterns'
import { QuickActionsSettings } from './QuickActionsSettings'
import '@terminator/extension-ui/settings-fields.css'
import './SettingsPanel.css'
import { ThemeChoices } from './ThemeChoices'

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
  { key: 'terminalStartFailed', label: 'Terminal could not start' },
  { key: 'splitPaneFailed', label: 'Split pane failed' },
  { key: 'closeTerminalFailed', label: 'Close terminal failed' },
  { key: 'remoteTunnelDisconnected', label: 'Remote tunnel disconnected' },
  { key: 'updateReady', label: 'Update ready to install' },
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
  const settings = useSettingsStore((s) => s.globalSettings)
  if (!settings) return <div>Loading...</div>
  return (
    <>
      <div className="settings-section">
        <h3 className="settings-section__title">Appearance</h3>
        <GlobalThemeField theme={settings.appearance.theme} />
        <SectionTitle>Terminal</SectionTitle>
        <TerminalFields settings={settings} />
        <SectionTitle>Interface</SectionTitle>
        <InterfaceFields settings={settings} />
        <SectionTitle>Git</SectionTitle>
        <GitFields settings={settings} />
        <SectionTitle>Notifications</SectionTitle>
        <DefaultTargetsField settings={settings} />
        <OverridesField settings={settings} />
      </div>
      <QuickActionsSettings scope="global" />
    </>
  )
}

type Settings = GlobalSettingsValue

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3 className="settings-section__title" style={{ marginTop: 20 }}>
      {children}
    </h3>
  )
}

function GlobalThemeField({ theme }: { theme: Settings['appearance']['theme'] }): JSX.Element {
  const updateGlobalTheme = useSettingsStore((s) => s.updateGlobalTheme)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Theme</label>
      <div className="settings-section__radio-group">
        <ThemeChoices checked={theme} onChange={updateGlobalTheme} />
      </div>
    </div>
  )
}

/** Scrollback, the default shell, and whether a new terminal asks for a name. */
function TerminalFields({ settings }: { settings: Settings }): JSX.Element {
  const updateScrollbackLimit = useSettingsStore((s) => s.updateScrollbackLimit)
  return (
    <>
      <div className="settings-section__field">
        <label className="settings-section__label">Scrollback Limit (1,000–100,000 lines)</label>
        <input
          type="number"
          className="settings-section__input"
          value={settings.terminal.scrollbackLimit}
          min={1000}
          max={100000}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1000 && val <= 100000) updateScrollbackLimit(val)
          }}
        />
      </div>
      <GlobalDefaultShellField shell={settings.terminal.defaultShell} />
      <PromptForNameField checked={settings.terminal.promptForName ?? false} />
    </>
  )
}

function GlobalDefaultShellField({ shell }: { shell: string }): JSX.Element {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Default Shell</label>
      <input
        type="text"
        className="settings-section__input"
        defaultValue={shell}
        onBlur={(e) => {
          const val = e.target.value.trim()
          if (val) window.electronAPI.settings.updateGlobal({ terminal: { defaultShell: val } })
        }}
      />
    </div>
  )
}

function PromptForNameField({ checked }: { checked: boolean }): JSX.Element {
  const updatePromptForName = useSettingsStore((s) => s.updatePromptForName)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label settings-section__label--inline">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => void updatePromptForName(e.target.checked)}
        />
        Prompt for session name on creation
      </label>
      <span className="settings-section__hint">
        When enabled, you are asked to name each new terminal before it opens. Leave blank to use
        the default &ldquo;Terminal N&rdquo; name.
      </span>
    </div>
  )
}

/** The metrics bar, and how long a quiet session waits before it reads as stale. */
function InterfaceFields({ settings }: { settings: Settings }): JSX.Element {
  const updateShowMetricsBar = useSettingsStore((s) => s.updateShowMetricsBar)
  return (
    <>
      <div className="settings-section__field">
        <label className="settings-section__label settings-section__label--inline">
          <input
            type="checkbox"
            checked={settings.ui?.showMetricsBar ?? false}
            onChange={(e) => void updateShowMetricsBar(e.target.checked)}
          />
          Show CPU / Memory / Network bar
        </label>
        <span className="settings-section__hint">
          Displays a system metrics bar at the bottom of every screen.
        </span>
      </div>
      <HideSidebarOnHomeField hide={settings.ui?.hideSidebarOnHome ?? true} />
      <HomeLayoutField layout={settings.ui?.homeLayout ?? 'tasks'} />
      <StaleAfterField staleAfterMs={settings.sidebar.staleAfterMs} />
    </>
  )
}

const HIDE_SIDEBAR_LABEL = 'Hide the branch tree on Home'

function HideSidebarOnHomeField({ hide }: { hide: boolean }): JSX.Element {
  const updateHideSidebarOnHome = useSettingsStore((s) => s.updateHideSidebarOnHome)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label settings-section__label--inline">
        <input
          type="checkbox"
          checked={hide}
          onChange={(e) => void updateHideSidebarOnHome(e.target.checked)}
        />
        {HIDE_SIDEBAR_LABEL}
      </label>
      <span className="settings-section__hint">Press ⌘B to show it</span>
    </div>
  )
}

function HomeLayoutField({ layout }: { layout: HomeLayout }): JSX.Element {
  const updateHomeLayout = useSettingsStore((s) => s.updateHomeLayout)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor="home-layout">
        Home layout
      </label>
      <select
        id="home-layout"
        className="settings-section__input"
        value={layout}
        onChange={(e) => void updateHomeLayout(e.target.value as HomeLayout)}
      >
        <option value="classic">Classic</option>
        <option value="tasks">Tasks</option>
      </select>
      <span className="settings-section__hint">
        Tasks shows what needs you, then your tasks. Classic keeps the Desk as it was.
      </span>
    </div>
  )
}

function StaleAfterField({ staleAfterMs }: { staleAfterMs: number }): JSX.Element {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor="stale-after-minutes">
        Mark sessions stale after (minutes)
      </label>
      <input
        id="stale-after-minutes"
        type="number"
        className="settings-section__input"
        min={1}
        max={43200}
        defaultValue={Math.round(staleAfterMs / 60_000)}
        onBlur={(e) => {
          const minutes = Number(e.target.value)
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200) return
          window.electronAPI.settings.updateGlobal({
            sidebar: { staleAfterMs: Math.round(minutes) * 60_000 },
          })
        }}
      />
      <span className="settings-section__hint">
        How long a quiet session waits before the sidebar treats it as abandoned. A session waiting
        on you is never stale, however long it waits.
      </span>
    </div>
  )
}

/** Where worktrees go, and which branches every branch list leaves out. */
function GitFields({ settings }: { settings: Settings }): JSX.Element {
  const updateWorktreeBaseDir = useSettingsStore((s) => s.updateWorktreeBaseDir)
  return (
    <>
      <div className="settings-section__field">
        <label className="settings-section__label">Worktree Base Directory</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={settings.git.worktreeBaseDir}
          placeholder="Leave empty to use <repo>/.worktrees"
          onBlur={(e) => updateWorktreeBaseDir(e.target.value.trim())}
        />
        <span className="settings-section__hint">
          Where new git worktrees are created. Leave empty for the default (<code>.worktrees</code>{' '}
          inside the repo).
        </span>
      </div>
      <BranchExcludeField patterns={settings.git.branchExcludePatterns} />
    </>
  )
}

function BranchExcludeField({ patterns }: { patterns: string[] }): JSX.Element {
  const updateBranchExcludePatterns = useSettingsStore((s) => s.updateBranchExcludePatterns)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Branch Exclude Patterns</label>
      <textarea
        className="settings-section__input settings-section__textarea"
        defaultValue={patterns.join('\n')}
        placeholder={PATTERNS_PLACEHOLDER}
        rows={4}
        onBlur={(e) => void updateBranchExcludePatterns(parsePatterns(e.target.value))}
      />
      <span className="settings-section__hint">
        One pattern per line. <code>*</code> matches anything, including <code>/</code> (e.g.{' '}
        <code>gh-readonly-queue/*</code>). Matching branches are left out of every branch list (New
        branch, a pull request&apos;s base branch), and pull requests opened from them are left out
        of the review lists. The checked-out branch always shows.
      </span>
    </div>
  )
}

function toggleTarget(
  current: NotificationTarget[],
  target: NotificationTarget
): NotificationTarget[] {
  return current.includes(target) ? current.filter((t) => t !== target) : [...current, target]
}

interface TargetChecksProps {
  checked: NotificationTarget[]
  onChange: (targets: NotificationTarget[]) => void
}

/** One checkbox per delivery target; each toggles its target in `checked`. */
function TargetChecks({ checked, onChange }: TargetChecksProps): JSX.Element {
  return (
    <div className="settings-section__radio-group">
      {NOTIFICATION_TARGETS.map(({ value, label }) => (
        <label key={value} className="settings-section__radio">
          <input
            type="checkbox"
            checked={checked.includes(value)}
            onChange={() => onChange(toggleTarget(checked, value))}
          />
          {label}
        </label>
      ))}
    </div>
  )
}

function DefaultTargetsField({ settings }: { settings: Settings }): JSX.Element {
  const update = useSettingsStore((s) => s.updateNotificationDefaultTargets)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Default Delivery Targets</label>
      <TargetChecks
        checked={settings.notifications.defaultTargets}
        onChange={(targets) => void update(targets)}
      />
      <span className="settings-section__hint">
        Where notifications are delivered by default. Errors always show a toast regardless of this
        setting.
      </span>
    </div>
  )
}

/** Each core notification's own targets; none checked means the defaults. */
function OverridesField({ settings }: { settings: Settings }): JSX.Element {
  const update = useSettingsStore((s) => s.updateNotificationOverride)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Per-Notification Overrides (Core)</label>
      {CORE_NOTIFICATION_KEYS.map(({ key, label }) => (
        <div key={key} className="settings-section__ext-override-row">
          <span className="settings-section__ext-override-name">{label}</span>
          <TargetChecks
            checked={settings.notifications.overrides[key] ?? []}
            onChange={(targets) => void update(key, targets)}
          />
        </div>
      ))}
      <span className="settings-section__hint">
        Leave all unchecked for a notification to use the default targets above. Each
        extension&rsquo;s own notifications are configured in that extension&rsquo;s settings panel,
        not here.
      </span>
    </div>
  )
}
