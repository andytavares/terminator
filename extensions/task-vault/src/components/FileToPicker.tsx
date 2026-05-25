import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { IndexedProject } from '../vault/types'

interface AreaData {
  filePath: string
  name: string
}

interface DestOption {
  kind: 'project' | 'area'
  label: string
  sublabel?: string
  filePath: string
}

export function FileToPicker({
  prefilledQuery,
  onSelect,
  onClose,
}: {
  prefilledQuery: string
  onSelect: (filePath: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState(prefilledQuery)
  const [options, setOptions] = useState<DestOption[]>([])
  const [loading, setLoading] = useState(true)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    Promise.all([
      window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {
        status: ['active', 'someday'],
      }),
      window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas'),
    ])
      .then(([projResult, areaResult]) => {
        const opts: DestOption[] = []
        if (projResult && typeof projResult === 'object' && 'projects' in projResult) {
          for (const p of (projResult as { projects: IndexedProject[] }).projects) {
            opts.push({
              kind: 'project',
              label: p.name,
              sublabel: p.area ? `#${p.area}` : undefined,
              filePath: p.filePath,
            })
          }
        }
        if (areaResult && typeof areaResult === 'object' && 'areas' in areaResult) {
          for (const a of (areaResult as { areas: AreaData[] }).areas) {
            opts.push({ kind: 'area', label: a.name, filePath: a.filePath })
          }
        }
        setOptions(opts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setHighlighted(0)
  }, [query])

  const q = query.toLowerCase().replace(/^[@#]/, '')
  const filtered = options.filter(
    (o) => !q || o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
  )

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) onSelect(filtered[highlighted].filePath)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="file-to-picker">
      <div className="file-to-picker__header">
        <input
          ref={inputRef}
          className="file-to-picker__search"
          type="text"
          placeholder="Search projects & areas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="file-to-picker__close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {loading ? (
        <div className="file-to-picker__loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="file-to-picker__empty">No matches.</div>
      ) : (
        <ul className="file-to-picker__list">
          {filtered.map((opt, i) => (
            <li
              key={opt.filePath}
              className={`file-to-picker__option${i === highlighted ? ' file-to-picker__option--highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(opt.filePath)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className={`file-to-picker__kind file-to-picker__kind--${opt.kind}`}>
                {opt.kind === 'project' ? '@' : '#'}
              </span>
              <span className="file-to-picker__label">{opt.label}</span>
              {opt.sublabel && <span className="file-to-picker__sublabel">{opt.sublabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
