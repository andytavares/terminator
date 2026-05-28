import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { IndexedProject } from '../vault/types'

interface AreaData {
  filePath: string
  name: string
}

interface DestOption {
  kind: 'project' | 'area' | 'create-project' | 'create-area'
  label: string
  sublabel?: string
  filePath: string
  createName?: string
}

export function FileToPicker({
  prefilledQuery,
  onSelect,
  onSelectNew,
  onClose,
}: {
  prefilledQuery: string
  onSelect: (filePath: string) => void
  onSelectNew?: (kind: 'project' | 'area', name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState(prefilledQuery)
  const [baseOptions, setBaseOptions] = useState<DestOption[]>([])
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
              filePath: `projects/${p.name}.md`,
            })
          }
        }
        if (areaResult && typeof areaResult === 'object' && 'areas' in areaResult) {
          for (const a of (areaResult as { areas: AreaData[] }).areas) {
            opts.push({ kind: 'area', label: a.name, filePath: `areas/${a.name}.md` })
          }
        }
        setBaseOptions(opts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setHighlighted(0)
  }, [query])

  const q = query.trim().toLowerCase().replace(/^[@#]/, '')
  const filtered: DestOption[] = baseOptions.filter(
    (o) => !q || o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
  )

  if (onSelectNew && q.length > 0) {
    const exactProject = baseOptions.some(
      (o) => o.kind === 'project' && o.label.toLowerCase() === q
    )
    const exactArea = baseOptions.some((o) => o.kind === 'area' && o.label.toLowerCase() === q)
    if (!exactProject) {
      filtered.push({
        kind: 'create-project',
        label: `Create project "${query.trim()}"`,
        filePath: '',
        createName: query.trim(),
      })
    }
    if (!exactArea) {
      filtered.push({
        kind: 'create-area',
        label: `Create area "${query.trim()}"`,
        filePath: '',
        createName: query.trim(),
      })
    }
  }

  function select(opt: DestOption) {
    if (opt.kind === 'create-project' || opt.kind === 'create-area') {
      onSelectNew?.(opt.kind === 'create-project' ? 'project' : 'area', opt.createName!)
    } else {
      onSelect(opt.filePath)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) select(filtered[highlighted])
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
          placeholder="Search or create project / area…"
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
        <div className="file-to-picker__empty">Type to search or create…</div>
      ) : (
        <ul className="file-to-picker__list">
          {filtered.map((opt, i) => (
            <li
              key={
                opt.kind === 'create-project' || opt.kind === 'create-area'
                  ? `${opt.kind}-${opt.createName}`
                  : opt.filePath
              }
              className={[
                'file-to-picker__option',
                i === highlighted ? 'file-to-picker__option--highlighted' : '',
                opt.kind === 'create-project' || opt.kind === 'create-area'
                  ? 'file-to-picker__option--create'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseDown={(e) => {
                e.preventDefault()
                select(opt)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span
                className={`file-to-picker__kind file-to-picker__kind--${opt.kind === 'create-project' ? 'project' : opt.kind === 'create-area' ? 'area' : opt.kind}`}
              >
                {opt.kind === 'project' || opt.kind === 'create-project'
                  ? '@'
                  : opt.kind === 'area' || opt.kind === 'create-area'
                    ? '#'
                    : ''}
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
