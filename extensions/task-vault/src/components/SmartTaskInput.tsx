import React, { useEffect, useRef, useState } from 'react'
import { useCloseOnOutsidePress } from '@terminator/extension-ui'
import { DateTimePicker } from './DateTimePicker'

interface SmartTaskInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  onCancel?: () => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

type TriggerType = 'project' | 'area' | 'context' | 'date'

interface ActiveTrigger {
  type: TriggerType
  query: string
  triggerStart: number
  triggerChar: string
}

interface DropdownOption {
  label: string
  value: string
  isCreate?: boolean
}

/** Each trigger and the pattern that spots it before the cursor; due: comes first. */
const TRIGGERS: { type: TriggerType; pattern: RegExp }[] = [
  { type: 'date', pattern: /(^|\s)(due:)(\S*)$/ },
  { type: 'project', pattern: /(^|\s)(@)(\S*)$/ },
  { type: 'area', pattern: /(^|\s)(#)(\S*)$/ },
  { type: 'context', pattern: /(^|\s)(\+)(\S*)$/ },
]

/** Which trigger is active given the text and cursor position. */
function detectTrigger(text: string, cursor: number): ActiveTrigger | null {
  const before = text.slice(0, cursor)
  for (const { type, pattern } of TRIGGERS) {
    const match = pattern.exec(before)
    if (match) {
      const triggerStart = match.index + match[1].length
      return { type, query: match[3], triggerStart, triggerChar: match[2] }
    }
  }
  return null
}

/** Global option cache — loaded once, shared across instances. */
const optionCache: {
  projects: DropdownOption[]
  areas: DropdownOption[]
  contexts: DropdownOption[]
  loaded: boolean
} = { projects: [], areas: [], contexts: [], loaded: false }

function namedOptions(result: unknown, key: 'projects' | 'areas'): DropdownOption[] | null {
  if (!result || typeof result !== 'object' || !(key in result)) return null
  const rows = (result as Record<string, { name: string }[]>)[key]
  return rows.map((row) => ({ label: row.name, value: row.name }))
}

function contextOptions(settings: unknown): DropdownOption[] {
  const values = (settings as { values: Record<string, unknown> }).values
  const contextsStr =
    (values['terminator.task-vault.contexts'] as string) ?? 'home,work,computer,phone,errands'
  return contextsStr
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ({ label: c, value: c }))
}

async function loadOptions(): Promise<void> {
  if (optionCache.loaded) return
  try {
    const [projectsResult, areasResult, settingsResult] = await Promise.all([
      window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {
        status: ['active', 'someday'],
      }),
      window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas'),
      window.electronAPI.extension.getSettingsValues(),
    ])
    optionCache.projects = namedOptions(projectsResult, 'projects') ?? optionCache.projects
    optionCache.areas = namedOptions(areasResult, 'areas') ?? optionCache.areas
    optionCache.contexts = contextOptions(settingsResult)
    optionCache.loaded = true
  } catch {
    // fallback — no suggestions available
  }
}

/** Matches for a project or area query, plus a create option unless it names one exactly. */
function withCreate(options: DropdownOption[], trigger: ActiveTrigger): DropdownOption[] {
  const q = trigger.query.toLowerCase()
  const qNorm = q.replace(/-/g, ' ')
  const matches = options.filter((o) => o.label.toLowerCase().includes(qNorm))
  const exactMatch = options.some((o) => o.label.toLowerCase() === qNorm)
  if (q.length === 0 || exactMatch) return matches
  return [...matches, { label: trigger.query, value: trigger.query, isCreate: true }]
}

function optionsFor(trigger: ActiveTrigger): DropdownOption[] {
  if (trigger.type === 'project') return withCreate(optionCache.projects, trigger)
  if (trigger.type === 'area') return withCreate(optionCache.areas, trigger)
  if (trigger.type !== 'context') return []
  const qNorm = trigger.query.toLowerCase().replace(/-/g, ' ')
  return optionCache.contexts.filter((o) => o.label.toLowerCase().includes(qNorm))
}

/** Replaces the active trigger and its query with `insert`. */
function replaceTrigger(value: string, active: ActiveTrigger, insert: string): string {
  const before = value.slice(0, active.triggerStart)
  const after = value.slice(active.triggerStart + active.triggerChar.length + active.query.length)
  return `${before}${insert}${after.trimStart()}`
}

/** Creates a new project or area; the tag is inserted even if creating it fails. */
async function createTag(type: TriggerType, name: string): Promise<void> {
  try {
    if (type === 'project') {
      await window.electronAPI.extensionBridge.invoke('task-vault:projects:create', { name })
      optionCache.projects.push({ label: name, value: name })
    } else if (type === 'area') {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:create-area', { name })
      optionCache.areas.push({ label: name, value: name })
    }
  } catch {
    // insert the tag even if creation fails
  }
}

type Input = React.RefObject<HTMLInputElement | null>

/** The active trigger, its suggestions, selection and date, tracked as the text changes. */
function useTriggerState() {
  const [active, setActive] = useState<ActiveTrigger | null>(null)
  const [options, setOptions] = useState<DropdownOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [dateValue, setDateValue] = useState('')
  const [optionsLoaded, setOptionsLoaded] = useState(optionCache.loaded)

  useEffect(() => {
    if (!optionCache.loaded) loadOptions().then(() => setOptionsLoaded(true))
  }, [])

  /** Re-reads the trigger at the cursor after an edit. */
  function track(text: string, cursor: number) {
    const trigger = detectTrigger(text, cursor)
    setActive(trigger)
    setSelectedIdx(0)
    const loaded = optionsLoaded || optionCache.loaded
    if (trigger && trigger.type !== 'date') setOptions(loaded ? optionsFor(trigger) : [])
    if (trigger?.type === 'date') setDateValue(trigger.query)
  }

  return {
    active,
    setActive,
    options,
    setOptions,
    selectedIdx,
    setSelectedIdx,
    dateValue,
    setDateValue,
    track,
  }
}

/** The trigger state plus the edits that complete a trigger. */
function useTriggers(props: SmartTaskInputProps, inputRef: Input) {
  const state = useTriggerState()
  const { active, setActive, setOptions } = state

  function completeTrigger(insert: string) {
    if (!active) return
    props.onChange(replaceTrigger(props.value, active, insert))
    setActive(null)
    inputRef.current?.focus()
  }

  async function chooseOption(option: DropdownOption) {
    if (!active) return
    if (option.isCreate) await createTag(active.type, option.value)
    completeTrigger(`${active.triggerChar}${option.value.replace(/ /g, '-')} `)
    setOptions([])
  }

  return { ...state, complete: completeTrigger, choose: chooseOption }
}

type Triggers = ReturnType<typeof useTriggers>

/** Inside a @/#/+ tag a space becomes a hyphen, keeping the tag one word. */
function insertHyphen(props: SmartTaskInputProps, input: HTMLInputElement, t: Triggers) {
  const { value, onChange } = props
  const cursor = input.selectionStart ?? value.length
  const newVal = value.slice(0, cursor) + '-' + value.slice(cursor)
  onChange(newVal)
  t.track(newVal, cursor + 1)
  requestAnimationFrame(() => input.setSelectionRange(cursor + 1, cursor + 1))
}

/** Arrow, Enter, Tab and Escape keys while suggestions are listed; returns whether handled. */
function handleListKey(e: React.KeyboardEvent, t: Triggers): boolean {
  const last = t.options.length - 1
  const moves: Record<string, () => void> = {
    ArrowDown: () => t.setSelectedIdx((i) => Math.min(i + 1, last)),
    ArrowUp: () => t.setSelectedIdx((i) => Math.max(i - 1, 0)),
    Enter: () => void t.choose(t.options[t.selectedIdx]),
    Tab: () => void t.choose(t.options[t.selectedIdx]),
  }
  if (e.key === 'Escape') {
    t.setActive(null)
    return true
  }
  if (!Object.hasOwn(moves, e.key)) return false
  e.preventDefault()
  moves[e.key]()
  return true
}

/** Escape closes an open trigger, else cancels; Enter closes an open trigger, else submits. */
function handleFieldKey(e: React.KeyboardEvent, props: SmartTaskInputProps, t: Triggers) {
  if (e.key === 'Escape') {
    if (!t.active) return props.onCancel?.()
    e.stopPropagation()
    t.setActive(null)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (t.active) t.setActive(null)
    else props.onSubmit()
  }
}

function triggerKeyDownHandler(props: SmartTaskInputProps, t: Triggers) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    const inTag = t.active !== null && t.active.type !== 'date'
    if (inTag && e.key === ' ') {
      e.preventDefault()
      return insertHyphen(props, e.currentTarget, t)
    }
    if (inTag && t.options.length > 0 && handleListKey(e, t)) return
    handleFieldKey(e, props, t)
  }
}

function DatePane({ t }: { t: Triggers }): React.JSX.Element {
  return (
    <div className="smart-input__date-picker">
      <DateTimePicker
        mode="date"
        defaultOpen
        value={t.dateValue}
        onChange={(v) => {
          t.setDateValue(v)
          t.complete(v ? `due:${v} ` : '')
        }}
        className="dtp--full"
      />
    </div>
  )
}

const LIST_LABELS: Partial<Record<TriggerType, string>> = {
  project: 'Projects',
  area: 'Areas',
  context: 'Contexts',
}

interface OptionProps {
  opt: DropdownOption
  selected: boolean
  triggerChar: string
  onChoose: () => void
  onHover: () => void
}

function dropdownOptionClass(opt: DropdownOption, selected: boolean): string {
  let cls = 'smart-input__option'
  if (selected) cls += ' smart-input__option--selected'
  if (opt.isCreate) cls += ' smart-input__option--create'
  return cls
}

function OptionButton(props: OptionProps): React.JSX.Element {
  const { opt, triggerChar } = props
  return (
    <button
      className={dropdownOptionClass(opt, props.selected)}
      onClick={props.onChoose}
      onMouseEnter={props.onHover}
    >
      {opt.isCreate ? (
        <>
          <span className="smart-input__option-create-icon">+</span>
          Create "{triggerChar}
          {opt.label}"
        </>
      ) : (
        <>
          <span className="smart-input__option-trigger">{triggerChar}</span>
          {opt.label}
        </>
      )}
    </button>
  )
}

function SuggestionList({ t, active }: { t: Triggers; active: ActiveTrigger }) {
  return (
    <>
      <div className="smart-input__dropdown-label">{LIST_LABELS[active.type]}</div>
      {t.options.length === 0 && <div className="smart-input__dropdown-empty">No matches</div>}
      {t.options.map((opt, i) => (
        <OptionButton
          key={opt.isCreate ? `__create__${opt.value}` : opt.value}
          opt={opt}
          selected={i === t.selectedIdx}
          triggerChar={active.triggerChar}
          onChoose={() => void t.choose(opt)}
          onHover={() => t.setSelectedIdx(i)}
        />
      ))}
    </>
  )
}

function fieldChangeHandler(onChange: (value: string) => void, t: Triggers) {
  return (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
    t.track(e.target.value, e.target.selectionStart ?? e.target.value.length)
  }
}

const DEFAULT_PLACEHOLDER = 'Add task… (@project #area +context due:YYYY-MM-DD)'

interface DropdownProps {
  t: Triggers
}

function TriggerDropdown({ t }: DropdownProps): React.JSX.Element | null {
  const { active } = t
  if (!active) return null
  return (
    <div className="smart-input__dropdown">
      {active.type === 'date' ? <DatePane t={t} /> : <SuggestionList t={t} active={active} />}
    </div>
  )
}

export function SmartTaskInput(props: SmartTaskInputProps): React.JSX.Element {
  const { value, onChange, className } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const t = useTriggers(props, inputRef)
  useCloseOnOutsidePress(containerRef, () => t.setActive(null), t.active !== null)
  return (
    <div className="smart-input" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className={`smart-input__field${className ? ` ${className}` : ''}`}
        value={value}
        onChange={fieldChangeHandler(onChange, t)}
        onKeyDown={triggerKeyDownHandler(props, t)}
        placeholder={props.placeholder ?? DEFAULT_PLACEHOLDER}
        disabled={props.disabled ?? false}
        autoFocus={props.autoFocus ?? false}
      />
      <TriggerDropdown t={t} />
    </div>
  )
}

/** Invalidates the option cache so it reloads next time. */
export function invalidateSmartInputCache() {
  optionCache.loaded = false
  optionCache.projects = []
  optionCache.areas = []
  optionCache.contexts = []
}
