import React, { useEffect, useRef, useState, useCallback } from 'react'

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

interface ActiveTrigger {
  type: 'project' | 'area' | 'context' | 'date'
  query: string
  triggerStart: number
  triggerChar: string
}

interface DropdownOption {
  label: string
  value: string
}

// Detect which trigger is active given the text and cursor position
function detectTrigger(text: string, cursor: number): ActiveTrigger | null {
  const before = text.slice(0, cursor)

  // due: trigger — must come before @ # + to avoid false positives
  const dueMatch = /(^|\s)(due:)(\S*)$/.exec(before)
  if (dueMatch) {
    const start = dueMatch.index + dueMatch[1].length
    return { type: 'date', query: dueMatch[3], triggerStart: start, triggerChar: 'due:' }
  }

  // @ trigger — project
  const projMatch = /(^|\s)(@)(\S*)$/.exec(before)
  if (projMatch) {
    const start = projMatch.index + projMatch[1].length
    return { type: 'project', query: projMatch[3], triggerStart: start, triggerChar: '@' }
  }

  // # trigger — area
  const areaMatch = /(^|\s)(#)(\S*)$/.exec(before)
  if (areaMatch) {
    const start = areaMatch.index + areaMatch[1].length
    return { type: 'area', query: areaMatch[3], triggerStart: start, triggerChar: '#' }
  }

  // + trigger — context
  const ctxMatch = /(^|\s)(\+)(\S*)$/.exec(before)
  if (ctxMatch) {
    const start = ctxMatch.index + ctxMatch[1].length
    return { type: 'context', query: ctxMatch[3], triggerStart: start, triggerChar: '+' }
  }

  return null
}

// Global option cache — loaded once, shared across instances
const optionCache: {
  projects: DropdownOption[]
  areas: DropdownOption[]
  contexts: DropdownOption[]
  loaded: boolean
} = { projects: [], areas: [], contexts: [], loaded: false }

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

    if (projectsResult && typeof projectsResult === 'object' && 'projects' in projectsResult) {
      const projects = (projectsResult as { projects: { name: string; filePath: string }[] })
        .projects
      optionCache.projects = projects.map((p) => ({ label: p.name, value: p.name }))
    }

    if (areasResult && typeof areasResult === 'object' && 'areas' in areasResult) {
      const areas = (areasResult as { areas: { name: string; filePath: string }[] }).areas
      optionCache.areas = areas.map((a) => ({ label: a.name, value: a.name }))
    }

    const values = (settingsResult as { values: Record<string, unknown> }).values
    const contextsStr =
      (values['terminator.task-vault.contexts'] as string) ?? 'home,work,computer,phone,errands'
    optionCache.contexts = contextsStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => ({ label: c, value: c }))

    optionCache.loaded = true
  } catch {
    // fallback — no suggestions available
  }
}

export function SmartTaskInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = 'Add task… (@project #area +context due:YYYY-MM-DD)',
  disabled = false,
  autoFocus = false,
  className,
}: SmartTaskInputProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ActiveTrigger | null>(null)
  const [options, setOptions] = useState<DropdownOption[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [dateValue, setDateValue] = useState('')
  const [optionsLoaded, setOptionsLoaded] = useState(optionCache.loaded)

  // Ensure options are loaded
  useEffect(() => {
    if (!optionCache.loaded) {
      loadOptions().then(() => setOptionsLoaded(true))
    }
  }, [])

  const getOptionsForTrigger = useCallback(
    (trigger: ActiveTrigger): DropdownOption[] => {
      if (!optionsLoaded && !optionCache.loaded) return []
      const q = trigger.query.toLowerCase()
      const qNorm = q.replace(/-/g, ' ')
      switch (trigger.type) {
        case 'project':
          return optionCache.projects.filter((o) => o.label.toLowerCase().includes(qNorm))
        case 'area':
          return optionCache.areas.filter((o) => o.label.toLowerCase().includes(qNorm))
        case 'context':
          return optionCache.contexts.filter((o) => o.label.toLowerCase().includes(qNorm))
        default:
          return []
      }
    },
    [optionsLoaded]
  )

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    onChange(val)

    const trigger = detectTrigger(val, cursor)
    setActive(trigger)
    setSelectedIdx(0)

    if (trigger && trigger.type !== 'date') {
      setOptions(getOptionsForTrigger(trigger))
    }
    if (trigger?.type === 'date') {
      setDateValue(trigger.query)
    }
  }

  function handleSelect(option: DropdownOption) {
    if (!active) return
    const before = value.slice(0, active.triggerStart)
    const after = value.slice(active.triggerStart + active.triggerChar.length + active.query.length)
    const slug = option.value.replace(/ /g, '-')
    const newValue = `${before}${active.triggerChar}${slug} ${after.trimStart()}`
    onChange(newValue)
    setActive(null)
    setOptions([])
    inputRef.current?.focus()
  }

  function handleDateSelect(date: string) {
    if (!active || !date) return
    const before = value.slice(0, active.triggerStart)
    const after = value.slice(active.triggerStart + active.triggerChar.length + active.query.length)
    const newValue = `${before}due:${date} ${after.trimStart()}`
    onChange(newValue)
    setActive(null)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (active && active.type !== 'date' && options.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, options.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        handleSelect(options[selectedIdx])
        return
      }
      if (e.key === 'Escape') {
        setActive(null)
        return
      }
    }

    if (e.key === 'Escape') {
      if (active) {
        setActive(null)
        return
      }
      onCancel?.()
      return
    }

    if (e.key === 'Enter' && !active) {
      e.preventDefault()
      onSubmit()
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        !inputRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setActive(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const showDropdown = active !== null

  return (
    <div className="smart-input">
      <input
        ref={inputRef}
        type="text"
        className={`smart-input__field${className ? ` ${className}` : ''}`}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
      />

      {showDropdown && (
        <div ref={dropdownRef} className="smart-input__dropdown">
          {active?.type === 'date' ? (
            <div className="smart-input__date-picker">
              <div className="smart-input__dropdown-label">Pick a due date</div>
              <input
                type="date"
                className="smart-input__date-input"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDateSelect(dateValue)
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setActive(null)
                  }
                }}
                autoFocus
              />
              <button
                className="smart-input__date-apply tv-btn tv-btn--primary"
                onClick={() => handleDateSelect(dateValue)}
                disabled={!dateValue}
              >
                Apply
              </button>
            </div>
          ) : (
            <>
              <div className="smart-input__dropdown-label">
                {active?.type === 'project' && 'Projects'}
                {active?.type === 'area' && 'Areas'}
                {active?.type === 'context' && 'Contexts'}
              </div>
              {options.length === 0 ? (
                <div className="smart-input__dropdown-empty">No matches</div>
              ) : (
                options.map((opt, i) => (
                  <button
                    key={opt.value}
                    className={`smart-input__option${i === selectedIdx ? ' smart-input__option--selected' : ''}`}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <span className="smart-input__option-trigger">{active?.triggerChar}</span>
                    {opt.label}
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Invalidate the option cache so it reloads next time
export function invalidateSmartInputCache() {
  optionCache.loaded = false
  optionCache.projects = []
  optionCache.areas = []
  optionCache.contexts = []
}
