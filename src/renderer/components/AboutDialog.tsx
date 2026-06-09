import { useEffect, useRef, useState } from 'react'
import './sidebar/Dialog.css'
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

export function AboutDialog({ onClose }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    window.electronAPI.app
      .getInfo()
      .then(setInfo)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog about-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About"
      >
        <div className="about-dialog__header">
          <div className="about-dialog__logo">⬛</div>
          <div className="about-dialog__name">{info?.appName ?? 'Terminator'}</div>
          <div className="about-dialog__version">v{info?.version ?? '—'}</div>
        </div>

        <dl className="about-dialog__info">
          <div className="about-dialog__row">
            <dt>Electron</dt>
            <dd>{info?.electronVersion ?? '—'}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>Node</dt>
            <dd>{info?.nodeVersion ?? '—'}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>Chrome</dt>
            <dd>{info?.chromeVersion ?? '—'}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>Platform</dt>
            <dd>{info?.platform ?? '—'}</dd>
          </div>
        </dl>

        <div className="dialog__actions">
          <button ref={closeRef} className="dialog__btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
