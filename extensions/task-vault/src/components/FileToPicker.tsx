import React, { useEffect, useRef, useState } from 'react'
import { IconButton, useDismissible } from '@terminator/extension-ui'
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

interface PickerProps {
  prefilledQuery: string
  onSelect: (filePath: string) => void
  onSelectNew?: (kind: 'project' | 'area', name: string) => void
  onClose: () => void
}

function isCreate(opt: DestOption): boolean {
  return opt.kind === 'create-project' || opt.kind === 'create-area'
}

/** Which kind of destination an option is, created or not. */
function baseKind(opt: DestOption): 'project' | 'area' {
  if (opt.kind === 'project' || opt.kind === 'create-project') return 'project'
  return 'area'
}

function projectOptions(result: unknown): DestOption[] {
  if (!result || typeof result !== 'object' || !('projects' in result)) return []
  return (result as { projects: IndexedProject[] }).projects.map((p) => ({
    kind: 'project',
    label: p.name,
    sublabel: p.area ? `#${p.area}` : undefined,
    filePath: `projects/${p.name}.md`,
  }))
}

function areaOptions(result: unknown): DestOption[] {
  if (!result || typeof result !== 'object' || !('areas' in result)) return []
  return (result as { areas: AreaData[] }).areas.map((a) => ({
    kind: 'area',
    label: a.name,
    filePath: `areas/${a.name}.md`,
  }))
}

/** The active and someday projects, then the areas, a task can be filed to. */
function useDestinations() {
  const [baseOptions, setBaseOptions] = useState<DestOption[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([
      window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {
        status: ['active', 'someday'],
      }),
      window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas'),
    ])
      .then(([projResult, areaResult]) => {
        setBaseOptions([...projectOptions(projResult), ...areaOptions(areaResult)])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  return { baseOptions, loading }
}

function createOption(kind: 'project' | 'area', name: string): DestOption {
  return {
    kind: kind === 'project' ? 'create-project' : 'create-area',
    label: `Create ${kind} "${name}"`,
    filePath: '',
    createName: name,
  }
}

interface Matching {
  baseOptions: DestOption[]
  query: string
  canCreate: boolean
}

/** Options matching the query, plus a create option for each kind it does not name exactly. */
function matchingOptions({ baseOptions, query, canCreate }: Matching): DestOption[] {
  const q = query.trim().toLowerCase().replace(/^[@#]/, '')
  const matchesDestination = (o: DestOption) =>
    !q || o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q)
  const filtered = baseOptions.filter(matchesDestination)
  if (!canCreate || q.length === 0) return filtered
  for (const kind of ['project', 'area'] as const) {
    const exact = baseOptions.some((o) => o.kind === kind && o.label.toLowerCase() === q)
    if (!exact) filtered.push(createOption(kind, query.trim()))
  }
  return filtered
}

/** The highlighted option, reset to the first whenever the query changes. */
function useHighlight(query: string) {
  const [highlighted, setHighlighted] = useState(0)
  const [highlightedFor, setHighlightedFor] = useState(query)
  if (highlightedFor !== query) {
    setHighlightedFor(query)
    setHighlighted(0)
  }
  return { highlighted, setHighlighted }
}

interface KeyNav {
  count: number
  setHighlighted: React.Dispatch<React.SetStateAction<number>>
  pick: () => void
  onClose: () => void
}

function keyHandler(nav: KeyNav) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      nav.setHighlighted((h) => Math.min(h + 1, nav.count - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nav.setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      nav.pick()
    } else if (e.key === 'Escape') {
      nav.onClose()
    }
  }
}

interface OptionProps {
  opt: DestOption
  highlighted: boolean
  onPick: () => void
  onHover: () => void
}

function destOptionClass(opt: DestOption, highlighted: boolean): string {
  return [
    'file-to-picker__option',
    highlighted ? 'file-to-picker__option--highlighted' : '',
    isCreate(opt) ? 'file-to-picker__option--create' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function OptionRow(props: OptionProps): React.JSX.Element {
  const { opt, highlighted, onPick, onHover } = props
  const kind = baseKind(opt)
  return (
    <li
      className={destOptionClass(opt, highlighted)}
      onMouseDown={(e) => {
        e.preventDefault()
        onPick()
      }}
      onMouseEnter={onHover}
    >
      <span className={`file-to-picker__kind file-to-picker__kind--${kind}`}>
        {kind === 'project' ? '@' : '#'}
      </span>
      <span className="file-to-picker__label">{opt.label}</span>
      {opt.sublabel && <span className="file-to-picker__sublabel">{opt.sublabel}</span>}
    </li>
  )
}

function optionKey(opt: DestOption): string {
  if (isCreate(opt)) return opt.kind + '-' + opt.createName
  return opt.filePath
}

interface ListProps {
  loading: boolean
  options: DestOption[]
  highlighted: number
  onPick: (opt: DestOption) => void
  onHover: (index: number) => void
}

function OptionList(props: ListProps): React.JSX.Element {
  const { loading, options, highlighted, onPick, onHover } = props
  if (loading) return <div className="file-to-picker__loading">Loading…</div>
  if (options.length === 0) {
    return <div className="file-to-picker__empty">Type to search or create…</div>
  }
  return (
    <ul className="file-to-picker__list">
      {options.map((opt, i) => (
        <OptionRow
          key={optionKey(opt)}
          opt={opt}
          highlighted={i === highlighted}
          onPick={() => onPick(opt)}
          onHover={() => onHover(i)}
        />
      ))}
    </ul>
  )
}

/** The picker's query, matching options, highlight and key handling. */
function useFileToPicker(props: PickerProps) {
  const { prefilledQuery, onSelect, onSelectNew, onClose } = props
  const [query, setQuery] = useState(prefilledQuery)
  const { baseOptions, loading } = useDestinations()
  const { highlighted, setHighlighted } = useHighlight(query)
  const options = matchingOptions({ baseOptions, query, canCreate: Boolean(onSelectNew) })
  function select(opt: DestOption) {
    if (isCreate(opt)) onSelectNew?.(baseKind(opt), opt.createName!)
    else onSelect(opt.filePath)
  }
  const pick = () => options[highlighted] && select(options[highlighted])
  const onKeyDown = keyHandler({
    count: options.length,
    setHighlighted,
    pick,
    onClose,
  })
  return { query, setQuery, loading, options, highlighted, setHighlighted, select, onKeyDown }
}

/** Picks where to file a task. useDismissible adds what Escape in the field did not cover: a click
 *  outside, and focus returning to whatever opened it. */
export function FileToPicker(props: PickerProps): React.JSX.Element {
  const picker = useFileToPicker(props)
  const inputRef = useRef<HTMLInputElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  useDismissible({ ref: surfaceRef, onDismiss: props.onClose, manageFocus: false })
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <div className="file-to-picker" ref={surfaceRef} data-tmui-surface="">
      <div className="file-to-picker__header">
        <input
          ref={inputRef}
          className="file-to-picker__search"
          type="text"
          placeholder="Search or create project / area…"
          value={picker.query}
          onChange={(e) => picker.setQuery(e.target.value)}
          onKeyDown={picker.onKeyDown}
        />
        <IconButton icon={X} label="Close" size="sm" onClick={props.onClose} />
      </div>
      <OptionList
        loading={picker.loading}
        options={picker.options}
        highlighted={picker.highlighted}
        onPick={picker.select}
        onHover={picker.setHighlighted}
      />
    </div>
  )
}
