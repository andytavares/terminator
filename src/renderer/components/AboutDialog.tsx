import { useEffect, useState } from 'react'
import { Dialog } from '@terminator/extension-ui'
import type { Extension } from '../../shared/types/index'
import { recordUse } from '../usage/record'
import './AboutDialog.css'

interface AppInfo {
  appName: string
  version: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
}

interface Props {
  onClose: () => void
}

type DbStatus = { ok: boolean; message?: string }

/** The app's versions and the database's health, as main reports them. */
function useAppInfo(): { info: AppInfo | null; dbStatus: DbStatus | null } {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  useEffect(() => {
    window.electronAPI.app
      .getInfo()
      .then(setInfo)
      .catch(() => {})
    window.electronAPI.db
      .health()
      .then(setDbStatus)
      .catch(() => setDbStatus({ ok: false, message: 'IPC error' }))
  }, [])
  return { info, dbStatus }
}

/** The installed extensions; none when the list cannot be read. */
function useExtensions(): Extension[] {
  const [extensions, setExtensions] = useState<Extension[]>([])
  useEffect(() => {
    window.electronAPI.extension
      .list()
      .then((result) => setExtensions(result.extensions))
      .catch(() => {})
  }, [])
  return extensions
}

function dbStatusText(dbStatus: DbStatus | null): string {
  if (dbStatus === null) return '—'
  return dbStatus.ok ? 'OK' : `Error — ${dbStatus.message ?? 'unknown'}`
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="about-dialog__row">
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  )
}

export function AboutDialog({ onClose }: Props) {
  const { info, dbStatus } = useAppInfo()
  const extensions = useExtensions()
  useEffect(() => recordUse('core.about', 'shown'), [])

  return (
    <Dialog
      title="About"
      onDismiss={onClose}
      actions={[{ label: 'Close', tone: 'primary', onSelect: onClose }]}
    >
      <div className="about-dialog">
        <div className="about-dialog__header">
          <div className="about-dialog__logo">⬛</div>
          <div className="about-dialog__name">{info?.appName ?? 'Terminator'}</div>
          <div className="about-dialog__version">v{info?.version ?? '—'}</div>
        </div>

        <dl className="about-dialog__info">
          <InfoRow label="Electron" value={info?.electronVersion} />
          <InfoRow label="Node" value={info?.nodeVersion} />
          <InfoRow label="Chrome" value={info?.chromeVersion} />
          <InfoRow label="Platform" value={info?.platform} />
          <InfoRow label="DB" value={dbStatusText(dbStatus)} />
        </dl>

        {extensions.length > 0 && (
          <>
            <h3 className="about-dialog__section">Extensions</h3>
            <dl className="about-dialog__info">
              {extensions.map((extension) => (
                <InfoRow
                  key={extension.id}
                  label={extension.name}
                  value={`v${extension.version}`}
                />
              ))}
            </dl>
          </>
        )}
      </div>
    </Dialog>
  )
}
