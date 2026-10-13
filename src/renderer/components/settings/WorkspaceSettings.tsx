import React, { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { QuickActionsSettings } from './QuickActionsSettings'
import '@terminator/extension-ui/settings-fields.css'
import './SettingsPanel.css'
import { ThemeChoices } from './ThemeChoices'
import { parsePatterns, PATTERNS_PLACEHOLDER } from './patterns'
import type {
  GlobalSettings,
  WorkspaceSettings as WorkspaceSettingsValue,
} from '../../../shared/types/index'

interface Props {
  workspaceId: string
}

export function WorkspaceSettings({ workspaceId }: Props): JSX.Element {
  const globalSettings = useSettingsStore((s) => s.globalSettings)
  const overrides = useSettingsStore((s) => s.workspaceSettings.get(workspaceId)?.overrides)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const name = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name)

  useEffect(() => {
    loadSettings(workspaceId)
  }, [workspaceId, loadSettings])

  if (!globalSettings) return <div>Loading...</div>
  const field = { workspaceId, effective: effectiveSettings(overrides, globalSettings) }

  return (
    <>
      <div className="settings-section">
        <h3 className="settings-section__title">Settings for: {name ?? workspaceId}</h3>
        <p className="settings-section__desc">Override global defaults for this workspace.</p>
        <WorkspaceFields field={field} own={ownSettings(overrides)} />
      </div>
      <QuickActionsSettings scope="workspace" workspaceId={workspaceId} />
    </>
  )
}

type Overrides = WorkspaceSettingsValue['overrides'] | undefined

/** Which settings this workspace sets for itself, so each can be handed back to the global value. */
function ownSettings(overrides: Overrides) {
  return {
    theme: !!overrides?.appearance?.theme,
    defaultShell: !!overrides?.terminal?.defaultShell,
    worktreeBaseDir: overrides?.git?.worktreeBaseDir !== undefined,
    branchExcludePatterns: overrides?.git?.branchExcludePatterns !== undefined,
  }
}

interface WorkspaceFieldsProps {
  field: Omit<FieldProps, 'overridden'>
  own: ReturnType<typeof ownSettings>
}

function WorkspaceFields({ field, own }: WorkspaceFieldsProps): JSX.Element {
  return (
    <>
      <ThemeField {...field} overridden={own.theme} />
      <ScrollbackField {...field} />
      <DefaultShellField {...field} overridden={own.defaultShell} />
      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Git
      </h3>
      <WorktreeDirField {...field} overridden={own.worktreeBaseDir} />
      <BranchExcludeField {...field} overridden={own.branchExcludePatterns} />
    </>
  )
}

/** Each setting as it applies here: this workspace's override, else the global value. */
function effectiveSettings(overrides: Overrides, global: GlobalSettings) {
  return {
    theme: overrides?.appearance?.theme ?? global.appearance.theme,
    ...effectiveTerminal(overrides?.terminal, global.terminal),
    ...effectiveGit(overrides?.git, global.git),
  }
}

function effectiveTerminal(
  terminal: NonNullable<Overrides>['terminal'],
  global: GlobalSettings['terminal']
) {
  return {
    scrollback: terminal?.scrollbackLimit ?? global.scrollbackLimit,
    defaultShell: terminal?.defaultShell ?? global.defaultShell,
  }
}

function effectiveGit(git: NonNullable<Overrides>['git'], global: GlobalSettings['git']) {
  return {
    worktreeBaseDir: git?.worktreeBaseDir ?? global.worktreeBaseDir,
    branchExcludePatterns: git?.branchExcludePatterns ?? global.branchExcludePatterns,
  }
}

interface FieldProps {
  workspaceId: string
  effective: ReturnType<typeof effectiveSettings>
  /** Whether this workspace sets its own value, so it can go back to the global one. */
  overridden?: boolean
}

function ThemeField({ workspaceId, effective, overridden }: FieldProps): JSX.Element {
  const updateWorkspaceTheme = useSettingsStore((s) => s.updateWorkspaceTheme)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Theme</label>
      <div className="settings-section__radio-group">
        <ThemeChoices
          checked={effective.theme}
          onChange={(t) => updateWorkspaceTheme(workspaceId, t)}
        />
        <label className="settings-section__radio">
          <input
            type="radio"
            checked={!overridden}
            onChange={() =>
              window.electronAPI.settings.updateWorkspace(workspaceId, { appearance: undefined })
            }
          />
          Use global default
        </label>
      </div>
    </div>
  )
}

function ScrollbackField({ workspaceId, effective }: FieldProps): JSX.Element {
  const updateWorkspaceScrollback = useSettingsStore((s) => s.updateWorkspaceScrollback)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Scrollback Limit</label>
      <input
        type="number"
        className="settings-section__input"
        value={effective.scrollback}
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
          window.electronAPI.settings.updateWorkspace(workspaceId, {
            terminal: { scrollbackLimit: undefined },
          })
        }
      >
        Use global default
      </button>
    </div>
  )
}

/** The shell this workspace's terminals open in; empty keeps the global one. */
function DefaultShellField({ workspaceId, effective, overridden }: FieldProps): JSX.Element {
  const update = useSettingsStore((s) => s.updateWorkspaceDefaultShell)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Default Shell</label>
      <input
        type="text"
        aria-label="Default Shell"
        className="settings-section__input"
        key={effective.defaultShell}
        defaultValue={effective.defaultShell}
        onBlur={(e) => {
          const shell = e.target.value.trim()
          if (shell && shell !== effective.defaultShell) void update(workspaceId, shell)
        }}
      />
      {overridden && <UseGlobalButton onClick={() => void update(workspaceId, undefined)} />}
    </div>
  )
}

function UseGlobalButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button className="settings-section__btn-link" onClick={onClick}>
      Use global default
    </button>
  )
}

function WorktreeDirField({ workspaceId, effective, overridden }: FieldProps): JSX.Element {
  const update = useSettingsStore((s) => s.updateWorkspaceWorktreeBaseDir)
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Worktree Base Directory</label>
      <input
        type="text"
        className="settings-section__input"
        key={effective.worktreeBaseDir}
        defaultValue={effective.worktreeBaseDir}
        placeholder="Leave empty to use <repo>/.worktrees"
        onBlur={(e) => update(workspaceId, e.target.value.trim() || undefined)}
      />
      <span className="settings-section__hint">
        Overrides the global setting for this workspace.
      </span>
      {overridden && <UseGlobalButton onClick={() => update(workspaceId, undefined)} />}
    </div>
  )
}

function BranchExcludeField({ workspaceId, effective, overridden }: FieldProps): JSX.Element {
  const update = useSettingsStore((s) => s.updateWorkspaceBranchExcludePatterns)
  const text = effective.branchExcludePatterns.join('\n')
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Branch Exclude Patterns</label>
      <textarea
        className="settings-section__input settings-section__textarea"
        key={text}
        defaultValue={text}
        placeholder={PATTERNS_PLACEHOLDER}
        rows={4}
        onBlur={(e) => {
          const patterns = parsePatterns(e.target.value)
          void update(workspaceId, patterns.length > 0 ? patterns : undefined)
        }}
      />
      <span className="settings-section__hint">
        Overrides global branch exclude patterns for this workspace.
      </span>
      {overridden && <UseGlobalButton onClick={() => void update(workspaceId, undefined)} />}
    </div>
  )
}
