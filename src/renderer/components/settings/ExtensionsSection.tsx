import React, { useEffect, useState } from 'react'
import { dispatchNotification } from '../../lib/notifications'
import { recordUse } from '../../usage/record'
import {
  ActionSettingRow,
  ExtensionSettingRow,
  NotificationSettingsTable,
  partitionNotificationSettings,
  readExtensionSettings,
  type ExtensionSchema,
} from './extension-setting-rows'

type Extension = {
  id: string
  name: string
  version: string
  status: string
  errorMessage?: string
}

type SetExtensions = React.Dispatch<React.SetStateAction<Extension[]>>

/** The installed extensions, their settings schemas, and the values set for them. */
function useExtensionListing() {
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [schemas, setSchemas] = useState<ExtensionSchema[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  // Read when the panel opens, and again whenever main says the list changed:
  // a backend can fail, or come back with its settings, while the panel is open.
  useEffect(() => {
    const readExtensions = (): void => {
      void window.electronAPI.extension.list().then((r) => setExtensions(r.extensions ?? []))
      readExtensionSettings({ setSchemas, setValues })
    }
    readExtensions()
    return window.electronAPI.extension.onListChanged(readExtensions)
  }, [])
  async function saveSetting(key: string, value: unknown): Promise<void> {
    await window.electronAPI.extension.updateSetting(key, value)
    recordUse('core.settings.change.extensions')
    setValues((prev) => ({ ...prev, [key]: value }))
  }
  return { extensions, setExtensions, schemas, values, saveSetting }
}

type Listing = ReturnType<typeof useExtensionListing>

type Notice = { title: string; message: string; key: string }

const notifyInfo = (n: Notice): void => dispatchNotification({ type: 'info', ...n })
const notifyFailure = (n: Notice): void => dispatchNotification({ type: 'error', ...n })

/** Installs from a folder the operator picks, and lists it once, however the list was re-read. */
async function installExtension(setExtensions: SetExtensions): Promise<void> {
  const picked = await window.electronAPI.dialog.openDirectory()
  if ('cancelled' in picked) return
  const result = await window.electronAPI.extension.install(picked.filePath)
  if (!('extension' in result)) {
    return notifyFailure({
      title: 'Extension install failed',
      message: result.error,
      key: 'extensionInstallFailed',
    })
  }
  // The list main announced may already hold it.
  const installed = result.extension
  recordUse('core.extensions.install')
  setExtensions((prev) => [...prev.filter((e) => e.id !== installed.id), installed])
  notifyInfo({
    title: 'Extension installed',
    message: 'Reload the window to activate it.',
    key: 'extensionInstalled',
  })
}

/** Enables or disables, then reloads the window so the change takes. */
async function toggleExtension(id: string, currentStatus: string): Promise<void> {
  const result = await window.electronAPI.extension.toggle(id, currentStatus !== 'enabled')
  if (!('extension' in result)) return
  recordUse('core.extensions.toggle')
  window.location.reload()
}

const replacing = (updated: Extension) => (prev: Extension[]) =>
  prev.map((e) => (e.id === updated.id ? updated : e))

async function reloadExtension(id: string, setExtensions: SetExtensions): Promise<void> {
  const result = await window.electronAPI.extension.reload(id)
  if (!('extension' in result)) {
    return notifyFailure({
      title: 'Extension reload failed',
      message: result.error,
      key: 'extensionReloadFailed',
    })
  }
  recordUse('core.extensions.reload')
  setExtensions(replacing(result.extension))
  notifyInfo({
    title: 'Extension reloaded',
    message: 'Reload the window to see UI changes.',
    key: 'extensionReloaded',
  })
}

/** Uninstalls once the operator confirms; it cannot be undone. */
async function uninstallExtension(ext: Extension, setExtensions: SetExtensions): Promise<void> {
  if (!window.confirm(`Uninstall "${ext.name}"? This cannot be undone.`)) return
  const result = await window.electronAPI.extension.uninstall(ext.id)
  if (!('ok' in result)) {
    return notifyFailure({
      title: 'Extension uninstall failed',
      message: result.error,
      key: 'extensionUninstallFailed',
    })
  }
  recordUse('core.extensions.uninstall')
  setExtensions((prev) => prev.filter((e) => e.id !== ext.id))
  notifyInfo({
    title: 'Extension uninstalled',
    message: `"${ext.name}" uninstalled. Reload the window to remove its UI.`,
    key: 'extensionUninstalled',
  })
}

const UPGRADE_FAILED = { title: 'Extension upgrade failed', key: 'extensionUpgradeFailed' }

/** Replaces an extension with the one in a folder the operator picks: uninstall, then install. */
async function upgradeExtension(id: string, setExtensions: SetExtensions): Promise<void> {
  const picked = await window.electronAPI.dialog.openDirectory()
  if ('cancelled' in picked) return
  const removed = await window.electronAPI.extension.uninstall(id)
  if ('error' in removed) return notifyFailure({ ...UPGRADE_FAILED, message: removed.error })
  const result = await window.electronAPI.extension.install(picked.filePath)
  if (!('extension' in result)) {
    return notifyFailure({ ...UPGRADE_FAILED, message: `Failed during install: ${result.error}` })
  }
  setExtensions(replacing(result.extension))
  notifyInfo({
    title: 'Extension upgraded',
    message: 'Reload the window to activate.',
    key: 'extensionUpgraded',
  })
}

export function ExtensionsSection(): React.JSX.Element {
  const listing = useExtensionListing()
  const { expanded, toggleExpanded } = useExpandedSettings()

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Extensions</h3>
      <button
        className="settings-section__btn"
        onClick={() => installExtension(listing.setExtensions)}
      >
        Install from Directory
      </button>
      {listing.extensions.length === 0 && (
        <p className="settings-section__empty">No extensions installed.</p>
      )}
      {listing.extensions.map((ext) => (
        <ExtensionEntry
          key={ext.id}
          ext={ext}
          listing={listing}
          expanded={expanded.has(ext.id)}
          onToggleSettings={() => toggleExpanded(ext.id)}
        />
      ))}
    </div>
  )
}

/** Which extensions have their settings opened. */
function useExpandedSettings() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return { expanded, toggleExpanded }
}

interface EntryProps {
  ext: Extension
  listing: Listing
  expanded: boolean
  onToggleSettings: () => void
}

/** One extension: its name, version and status, its actions, and its settings once opened. */
function ExtensionEntry({
  ext,
  listing,
  expanded,
  onToggleSettings,
}: EntryProps): React.JSX.Element {
  const schema = listing.schemas.find((s) => s.extensionId === ext.id)
  return (
    <div className="extension-item-wrapper">
      <div className="extension-item">
        <div className="extension-item__row">
          <div className="extension-item__meta">
            <span className="extension-item__name">{ext.name}</span>
            <span className="extension-item__version">v{ext.version}</span>
            <span
              className={`extension-item__status extension-item__status--${ext.status}`}
              title={ext.errorMessage}
            >
              {ext.status}
            </span>
          </div>
          <ExtensionActions
            {...{ ext, listing, expanded, onToggleSettings }}
            hasSettings={!!schema}
          />
        </div>
      </div>
      {schema && expanded && (
        <SettingsList schema={schema} values={listing.values} onChange={listing.saveSetting} />
      )}
    </div>
  )
}

/** Enable or Disable, Reload, Upgrade, Uninstall, and the settings toggle when it has any. */
function ExtensionActions({
  ext,
  listing,
  expanded,
  onToggleSettings,
  hasSettings,
}: EntryProps & { hasSettings: boolean }): React.JSX.Element {
  const { setExtensions } = listing
  return (
    <div className="extension-item__actions">
      <button className="ext-btn" onClick={() => toggleExtension(ext.id, ext.status)}>
        {ext.status === 'enabled' ? 'Disable' : 'Enable'}
      </button>
      <button className="ext-btn" onClick={() => reloadExtension(ext.id, setExtensions)}>
        Reload
      </button>
      <button className="ext-btn" onClick={() => upgradeExtension(ext.id, setExtensions)}>
        Upgrade
      </button>
      <button
        className="ext-btn ext-btn--danger"
        onClick={() => uninstallExtension(ext, setExtensions)}
      >
        Uninstall
      </button>
      {hasSettings && <ConfigureButton open={expanded} onClick={onToggleSettings} />}
    </div>
  )
}

function ConfigureButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      className={`ext-btn ext-btn--settings${open ? ' ext-btn--settings-open' : ''}`}
      onClick={onClick}
      title="Configure"
    >
      ⚙
    </button>
  )
}

interface SettingsListProps {
  schema: ExtensionSchema
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => Promise<void>
}

/** The schema's description, a row per setting or action, then its notifications table. */
function SettingsList({ schema, values, onChange }: SettingsListProps): React.JSX.Element {
  const { rows, rest } = partitionNotificationSettings(schema.properties)
  return (
    <div className="extension-settings-panel">
      {schema.description && <p className="extension-settings-panel__desc">{schema.description}</p>}
      {rest.map(([key, def]) =>
        def.type === 'action' && def.channel ? (
          <ActionSettingRow key={key} def={def} />
        ) : (
          <ExtensionSettingRow
            key={key}
            propKey={key}
            def={def}
            value={values[key] ?? def.default}
            onChange={onChange}
          />
        )
      )}
      {rows.length > 0 && (
        <NotificationSettingsTable rows={rows} values={values} onChange={onChange} />
      )}
    </div>
  )
}
