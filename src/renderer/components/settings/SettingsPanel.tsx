import React, { useState, useEffect } from 'react'
import { GlobalSettings } from './GlobalSettings'
import { WorkspaceSettings } from './WorkspaceSettings'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useToastStore } from '../../stores/toast.store'
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

type SettingPropDef = {
  type: string
  label: string
  description?: string
  default: unknown
  secret?: boolean
  options?: string[]
  min?: number
  max?: number
  channel?: string
  confirmMessage?: string
  danger?: boolean
}

type ExtensionSchema = {
  extensionId: string
  label: string
  description?: string
  properties: Record<string, SettingPropDef>
}

function ExtensionsSection(): JSX.Element {
  const [extensions, setExtensions] = React.useState<
    Array<{ id: string; name: string; version: string; status: string }>
  >([])
  const [schemas, setSchemas] = React.useState<ExtensionSchema[]>([])
  const [settingValues, setSettingValues] = React.useState<Record<string, unknown>>({})
  const [expandedSettings, setExpandedSettings] = React.useState<Set<string>>(new Set())
  const { addToast } = useToastStore()

  React.useEffect(() => {
    window.electronAPI.extension.list().then((r) => setExtensions(r.extensions ?? []))
    window.electronAPI.extension
      .getSettingsSchemas()
      .then((r) => setSchemas(r.schemas ?? []))
      .catch(() => {})
    window.electronAPI.extension
      .getSettingsValues()
      .then((r) => setSettingValues(r.values ?? {}))
      .catch(() => {})
  }, [])

  async function handleInstall(): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('cancelled' in result) return
    const installResult = await window.electronAPI.extension.install(result.filePath)
    if ('extension' in installResult) {
      setExtensions((prev) => [...prev, installResult.extension])
      addToast({ type: 'info', message: `Extension installed. Reload the window to activate it.` })
    } else {
      addToast({ type: 'error', message: `Failed to install extension: ${installResult.error}` })
    }
  }

  async function handleToggle(id: string, currentStatus: string): Promise<void> {
    const enabled = currentStatus !== 'enabled'
    const result = await window.electronAPI.extension.toggle(id, enabled)
    if ('extension' in result) {
      window.location.reload()
    }
  }

  async function handleReload(id: string): Promise<void> {
    const result = await window.electronAPI.extension.reload(id)
    if ('extension' in result) {
      setExtensions((prev) => prev.map((e) => (e.id === id ? result.extension : e)))
      addToast({
        type: 'info',
        message: `Extension reloaded. Reload the window to see UI changes.`,
      })
    } else {
      addToast({ type: 'error', message: `Reload failed: ${result.error}` })
    }
  }

  async function handleUninstall(id: string, name: string): Promise<void> {
    if (!window.confirm(`Uninstall "${name}"? This cannot be undone.`)) return
    const result = await window.electronAPI.extension.uninstall(id)
    if ('ok' in result) {
      setExtensions((prev) => prev.filter((e) => e.id !== id))
      addToast({
        type: 'info',
        message: `"${name}" uninstalled. Reload the window to remove its UI.`,
      })
    } else {
      addToast({ type: 'error', message: `Uninstall failed: ${result.error}` })
    }
  }

  async function handleSettingChange(key: string, value: unknown): Promise<void> {
    await window.electronAPI.extension.updateSetting(key, value)
    setSettingValues((prev) => ({ ...prev, [key]: value }))
  }

  function toggleSettingsExpand(id: string): void {
    setExpandedSettings((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleUpgrade(id: string): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('cancelled' in result) return
    const uninstallResult = await window.electronAPI.extension.uninstall(id)
    if ('error' in uninstallResult) {
      addToast({ type: 'error', message: `Upgrade failed: ${uninstallResult.error}` })
      return
    }
    const installResult = await window.electronAPI.extension.install(result.filePath)
    if ('extension' in installResult) {
      setExtensions((prev) => prev.map((e) => (e.id === id ? installResult.extension : e)))
      addToast({ type: 'info', message: `Extension upgraded. Reload the window to activate.` })
    } else {
      addToast({ type: 'error', message: `Upgrade failed during install: ${installResult.error}` })
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
      {extensions.map((ext) => {
        const schema = schemas.find((s) => s.extensionId === ext.id)
        const isExpanded = expandedSettings.has(ext.id)
        return (
          <div key={ext.id} className="extension-item-wrapper">
            <div className="extension-item">
              <div className="extension-item__row">
                <div className="extension-item__meta">
                  <span className="extension-item__name">{ext.name}</span>
                  <span className="extension-item__version">v{ext.version}</span>
                  <span className={`extension-item__status extension-item__status--${ext.status}`}>
                    {ext.status}
                  </span>
                </div>
                <div className="extension-item__actions">
                  <button className="ext-btn" onClick={() => handleToggle(ext.id, ext.status)}>
                    {ext.status === 'enabled' ? 'Disable' : 'Enable'}
                  </button>
                  <button className="ext-btn" onClick={() => handleReload(ext.id)}>
                    Reload
                  </button>
                  <button className="ext-btn" onClick={() => handleUpgrade(ext.id)}>
                    Upgrade
                  </button>
                  <button
                    className="ext-btn ext-btn--danger"
                    onClick={() => handleUninstall(ext.id, ext.name)}
                  >
                    Uninstall
                  </button>
                  {schema && (
                    <button
                      className={`ext-btn ext-btn--settings${isExpanded ? ' ext-btn--settings-open' : ''}`}
                      onClick={() => toggleSettingsExpand(ext.id)}
                      title="Configure"
                    >
                      ⚙
                    </button>
                  )}
                </div>
              </div>
            </div>
            {schema && isExpanded && (
              <div className="extension-settings-panel">
                {schema.description && (
                  <p className="extension-settings-panel__desc">{schema.description}</p>
                )}
                {Object.entries(schema.properties).map(([key, def]) =>
                  def.type === 'action' && def.channel ? (
                    <ActionSettingRow key={key} def={def} />
                  ) : (
                    <ExtensionSettingRow
                      key={key}
                      propKey={key}
                      def={def}
                      value={settingValues[key] ?? def.default}
                      onChange={handleSettingChange}
                    />
                  )
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ActionSettingRow({ def }: { def: SettingPropDef }): JSX.Element {
  const { addToast } = useToastStore()
  const [busy, setBusy] = React.useState(false)

  async function run(): Promise<void> {
    if (def.confirmMessage && !window.confirm(def.confirmMessage)) return
    setBusy(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(def.channel!, {})
      const errMsg = (result as { error?: string } | null)?.error
      const integrity = (result as { data?: { integrity?: string } } | null)?.data?.integrity
      if (errMsg) {
        addToast({ type: 'error', message: `${def.label}: ${errMsg}` })
      } else if (integrity && integrity !== 'ok') {
        addToast({ type: 'warning', message: `${def.label}: integrity issues — ${integrity}` })
      } else {
        addToast({ type: 'success', message: `${def.label}: done` })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: `${def.label}: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="extension-setting-row">
      {def.description && (
        <span className="extension-setting-row__label">
          <span className="extension-setting-row__desc">{def.description}</span>
        </span>
      )}
      <button
        className={`ext-btn${def.danger ? ' ext-btn--danger' : ''}`}
        onClick={() => void run()}
        disabled={busy}
      >
        {busy ? '…' : def.label}
      </button>
    </div>
  )
}

interface ExtensionSettingRowProps {
  propKey: string
  def: SettingPropDef
  value: unknown
  onChange: (key: string, value: unknown) => Promise<void>
}

function ExtensionSettingRow({
  propKey,
  def,
  value,
  onChange,
}: ExtensionSettingRowProps): JSX.Element {
  const [localValue, setLocalValue] = React.useState(String(value ?? def.default ?? ''))
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValue = React.useRef(localValue)

  React.useEffect(() => {
    latestValue.current = localValue
  })

  function scheduleSave(v: string): void {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const coerced = def.type === 'number' ? Number(v) : def.type === 'boolean' ? v === 'true' : v
      void onChange(propKey, coerced)
    }, 400)
  }

  function handleChange(v: string): void {
    setLocalValue(v)
    scheduleSave(v)
  }

  // Flush on unmount so closing the panel doesn't lose unsaved input
  React.useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        const v = latestValue.current
        const coerced =
          def.type === 'number' ? Number(v) : def.type === 'boolean' ? v === 'true' : v
        void onChange(propKey, coerced)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleFolderPick(): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('cancelled' in result) return
    handleChange(result.filePath)
  }

  return (
    <div className="extension-setting-row">
      <label className="extension-setting-row__label">
        {def.label}
        {def.description && <span className="extension-setting-row__desc">{def.description}</span>}
        {def.type === 'folder' && (
          <span className="ext-folder-row__path">
            {localValue || <span className="ext-folder-row__placeholder">Not set</span>}
          </span>
        )}
      </label>
      {def.type === 'boolean' ? (
        <button
          className={`ext-toggle${localValue === 'true' ? ' ext-toggle--on' : ''}`}
          role="switch"
          aria-checked={localValue === 'true'}
          aria-label={def.label}
          onClick={() => handleChange(localValue === 'true' ? 'false' : 'true')}
        />
      ) : def.type === 'enum' && def.options ? (
        <div className="ext-segmented">
          {def.options.map((opt) => (
            <button
              key={opt}
              className={`ext-segmented__btn${localValue === opt ? ' ext-segmented__btn--active' : ''}`}
              onClick={() => handleChange(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      ) : def.type === 'folder' ? (
        <button className="ext-btn ext-folder-row__btn" onClick={() => void handleFolderPick()}>
          Choose…
        </button>
      ) : (
        <input
          className="extension-setting-row__input"
          type={def.secret ? 'password' : def.type === 'number' ? 'number' : 'text'}
          value={localValue}
          min={def.min}
          max={def.max}
          onChange={(e) => handleChange(e.target.value)}
        />
      )}
    </div>
  )
}
