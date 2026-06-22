import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { CommandRegistration } from '../extensions/registry'
import './CommandPalette.css'

interface ExtensionCommand {
  key: string
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
}

interface PaletteItem {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  action(): void
}

interface Props {
  commands: CommandRegistration[]
  onClose(): void
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPalette({ commands, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [extensionCommands, setExtensionCommands] = useState<ExtensionCommand[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    window.electronAPI.extension
      .getCommands()
      .then((r) => setExtensionCommands(r.commands))
      .catch(() => {})
  }, [])

  const allItems = useMemo<PaletteItem[]>(() => {
    const rendererItems: PaletteItem[] = commands.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      shortcut: c.shortcut,
      category: c.category,
      action: c.action,
    }))
    const extItems: PaletteItem[] = extensionCommands.map((c) => ({
      id: `ext:${c.key}`,
      label: c.label,
      description: c.description,
      shortcut: c.shortcut,
      category: c.category ?? 'Extensions',
      action: () => window.electronAPI.extension.executeCommand(c.key),
    }))
    return [...rendererItems, ...extItems]
  }, [commands, extensionCommands])

  const filtered = useMemo(
    () => allItems.filter((item) => fuzzyMatch(query, item.label)),
    [allItems, query]
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const runActive = useCallback(() => {
    const item = filtered[activeIndex]
    if (item) {
      item.action()
      onClose()
    }
  }, [filtered, activeIndex, onClose])

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        runActive()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [filtered.length, onClose, runActive])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className="cmd-palette-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="cmd-palette__input-wrap">
          <span className="cmd-palette__search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="cmd-palette__input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label="Type a command"
            aria-expanded={filtered.length > 0}
            aria-controls="cmd-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={
              filtered.length > 0 ? `cmd-palette-option-${activeIndex}` : undefined
            }
          />
          <kbd className="cmd-palette__esc-hint">esc</kbd>
        </div>

        {filtered.length > 0 ? (
          <ul
            ref={listRef}
            className="cmd-palette__list"
            id="cmd-palette-list"
            role="listbox"
            aria-label="Commands"
          >
            {filtered.map((item, i) => (
              <li
                key={item.id}
                id={`cmd-palette-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`cmd-palette__item${i === activeIndex ? ' cmd-palette__item--active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  item.action()
                  onClose()
                }}
              >
                <div className="cmd-palette__item-main">
                  {item.category && (
                    <span className="cmd-palette__item-category">{item.category}</span>
                  )}
                  <span className="cmd-palette__item-label">{item.label}</span>
                  {item.description && (
                    <span className="cmd-palette__item-desc">{item.description}</span>
                  )}
                </div>
                {item.shortcut && <kbd className="cmd-palette__item-shortcut">{item.shortcut}</kbd>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="cmd-palette__empty">No commands match "{query}"</div>
        )}

        <div className="cmd-palette__footer">
          <span className="cmd-palette__hint">
            <kbd>↑↓</kbd> navigate &nbsp;·&nbsp; <kbd>↵</kbd> run &nbsp;·&nbsp; <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
