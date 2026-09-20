import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Pin, PinOff } from 'lucide-react'
import type { QuickAction, QuickActionGroup } from '../quick-actions/types'
import { searchActions } from '../quick-actions/search'
import { orderGroups } from '../quick-actions/rank'
import { useModalEffect } from '../stores/modal.store'
import './QuickActions.css'

export interface QuickActionsProps {
  groups: QuickActionGroup[]
  actions: QuickAction[]
  pinned: QuickAction[]
  recent: QuickAction[]
  pins: string[]
  contextGroupId: string | null
  contextLabel?: string
  searchSignal?: number
  onRun(action: QuickAction): void
  onTogglePin(id: string): void
  onClose(): void
}

type Row =
  | { kind: 'action'; id: string; action: QuickAction; keyLabel: string; groupLabel?: string }
  | { kind: 'group'; id: string; group: QuickActionGroup }

type Mode = 'top' | 'group' | 'search'

function actionRow(action: QuickAction, keyLabel: string, groupLabel?: string): Row {
  return { kind: 'action', id: `action:${action.id}`, action, keyLabel, groupLabel }
}

function groupRow(group: QuickActionGroup): Row {
  return { kind: 'group', id: `group:${group.id}`, group }
}

export function QuickActions({
  groups,
  actions,
  pinned,
  recent,
  pins,
  contextGroupId,
  contextLabel,
  searchSignal,
  onRun,
  onTogglePin,
  onClose,
}: QuickActionsProps): JSX.Element {
  useModalEffect()

  const [mode, setMode] = useState<Mode>('top')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const prevSearchSignal = useRef(searchSignal)

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const pinSet = useMemo(() => new Set(pins), [pins])

  useEffect(() => {
    if (searchSignal !== undefined && searchSignal !== prevSearchSignal.current) {
      prevSearchSignal.current = searchSignal
      setMode('search')
      setQuery('')
      setHighlight(0)
      setStatusMessage(null)
    }
  }, [searchSignal])

  useEffect(() => {
    if (mode === 'search') inputRef.current?.focus()
  }, [mode])

  // Move DOM focus into the panel as soon as it mounts. Without this, focus
  // stays on whatever was focused before ⌘P (most often the terminal), and
  // xterm attaches its own Escape handling directly to its textarea in the
  // capture phase — which stops propagation before this component's
  // window-level keydown listener ever sees the event. The panel would then
  // never close on Escape while a terminal had focus.
  useEffect(() => {
    if (mode !== 'search') panelRef.current?.focus()
  }, [mode])

  const contextRows = useMemo<Row[]>(() => {
    if (!contextGroupId) return []
    const group = groupById.get(contextGroupId)
    if (!group) return []
    return actions
      .filter((a) => a.group === contextGroupId)
      .map((a) => actionRow(a, `${group.mnemonic} ${a.mnemonic ?? ''}`.trim()))
  }, [contextGroupId, groupById, actions])

  const pinnedRecentRows = useMemo<Row[]>(() => {
    const toRow = (a: QuickAction): Row => {
      if (a.group === 'top') return actionRow(a, a.mnemonic ?? '')
      const group = groupById.get(a.group)
      const keyLabel = group ? `${group.mnemonic} ${a.mnemonic ?? ''}`.trim() : (a.mnemonic ?? '')
      return actionRow(a, keyLabel, group?.label)
    }
    return [...pinned.map(toRow), ...recent.map(toRow)]
  }, [pinned, recent, groupById])

  const orderedGroups = useMemo(() => orderGroups(groups, contextGroupId), [groups, contextGroupId])
  const groupRows = useMemo<Row[]>(() => orderedGroups.map(groupRow), [orderedGroups])

  const goRows = useMemo<Row[]>(
    () => actions.filter((a) => a.group === 'top').map((a) => actionRow(a, a.mnemonic ?? '')),
    [actions]
  )

  const topRows = useMemo<Row[]>(
    () => [...contextRows, ...pinnedRecentRows, ...groupRows, ...goRows],
    [contextRows, pinnedRecentRows, groupRows, goRows]
  )

  const currentGroup = groupId ? groupById.get(groupId) : undefined
  const groupActionRows = useMemo<Row[]>(() => {
    if (!groupId) return []
    return actions.filter((a) => a.group === groupId).map((a) => actionRow(a, a.mnemonic ?? ''))
  }, [groupId, actions])

  const searchResults = useMemo(
    () => (mode === 'search' ? searchActions(actions, groups, query) : []),
    [mode, query, actions, groups]
  )
  const searchRows = useMemo<Row[]>(
    () =>
      searchResults.map((a) => {
        const group = groupById.get(a.group)
        return actionRow(a, '', group?.label)
      }),
    [searchResults, groupById]
  )

  const visibleRows: Row[] =
    mode === 'top' ? topRows : mode === 'group' ? groupActionRows : searchRows

  useEffect(() => {
    setHighlight(0)
  }, [mode, groupId, query])

  useEffect(() => {
    const row = visibleRows[highlight]
    if (!row) return
    const el = panelRef.current?.querySelector(`[data-row-id="${row.id}"]`)
    ;(el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, visibleRows])

  const activateRow = useCallback(
    (row: Row | undefined) => {
      if (!row) return
      if (row.kind === 'group') {
        setGroupId(row.group.id)
        setMode('group')
        setStatusMessage(null)
        return
      }
      if (row.action.disabledReason) {
        setStatusMessage(row.action.disabledReason)
        return
      }
      setStatusMessage(null)
      onRun(row.action)
    },
    [onRun]
  )

  const enterSearch = useCallback(() => {
    setMode('search')
    setQuery('')
    setStatusMessage(null)
  }, [])

  const backToTop = useCallback(() => {
    setMode('top')
    setGroupId(null)
    setStatusMessage(null)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        const row = visibleRows[highlight]
        if (row && row.kind === 'action') {
          e.preventDefault()
          onTogglePin(row.action.id)
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (mode === 'search') {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlight((i) => Math.min(i + 1, searchRows.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlight((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          activateRow(searchRows[highlight])
        } else if (e.key === 'Backspace' && query === '') {
          e.preventDefault()
          backToTop()
        }
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (mode === 'group') {
        if (e.key === 'Backspace') {
          e.preventDefault()
          backToTop()
          return
        }
        if (e.key === '/') {
          e.preventDefault()
          enterSearch()
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlight((i) => Math.min(i + 1, groupActionRows.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlight((i) => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          activateRow(groupActionRows[highlight])
          return
        }
        if (e.key.length === 1) {
          const row = groupActionRows.find(
            (r) => r.kind === 'action' && r.action.mnemonic === e.key
          )
          if (row) {
            e.preventDefault()
            activateRow(row)
          }
        }
        return
      }

      // top mode
      if (e.key === '/') {
        e.preventDefault()
        enterSearch()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((i) => Math.min(i + 1, topRows.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        activateRow(topRows[highlight])
        return
      }
      if (e.key.length === 1) {
        const group = groups.find((g) => g.mnemonic === e.key)
        if (group) {
          e.preventDefault()
          setGroupId(group.id)
          setMode('group')
          setStatusMessage(null)
          return
        }
        const goAction = goRows.find((r) => r.kind === 'action' && r.action.mnemonic === e.key)
        if (goAction) {
          e.preventDefault()
          activateRow(goAction)
        }
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    mode,
    groups,
    topRows,
    groupActionRows,
    searchRows,
    goRows,
    visibleRows,
    highlight,
    query,
    activateRow,
    enterSearch,
    backToTop,
    onClose,
    onTogglePin,
  ])

  function renderKeyLabel(keyLabel: string): JSX.Element {
    // `.qa-row` is a 3-column grid (`24px 1fr auto`). Omitting this element
    // entirely for a mnemonic-less action (a direct-shortcut-only action, or
    // one surfaced dynamically) left only 2 grid children, so the label
    // landed in the 24px key column and clipped to a single letter. An empty,
    // invisible placeholder keeps every row's children aligned to the same
    // three columns.
    if (!keyLabel) return <span className="qa-key qa-key--empty" aria-hidden="true" />
    return <span className={`qa-key${keyLabel.length > 1 ? ' qa-key--wide' : ''}`}>{keyLabel}</span>
  }

  function renderActionRow(
    row: Extract<Row, { kind: 'action' }>,
    index: number,
    list: Row[]
  ): JSX.Element {
    const { action } = row
    const isPinned = pinSet.has(action.id)
    const isSelected = list === visibleRows && index === highlight
    return (
      <li
        key={row.id}
        data-row-id={row.id}
        role="option"
        aria-selected={isSelected}
        className={`qa-row${isSelected ? ' qa-row--selected' : ''}${action.disabledReason ? ' qa-row--disabled' : ''}`}
        onMouseEnter={() => setHighlight(index)}
        onMouseDown={(e) => {
          e.preventDefault()
          activateRow(row)
        }}
      >
        {renderKeyLabel(row.keyLabel)}
        <span className="qa-row__main">
          {row.groupLabel && <span className="qa-row__group">{row.groupLabel} ·</span>}
          <span className="qa-row__label">{action.label}</span>
          {action.description && !action.disabledReason && (
            <span className="qa-row__desc">{action.description}</span>
          )}
          {action.disabledReason && <span className="qa-row__reason">{action.disabledReason}</span>}
        </span>
        <span className="qa-row__end">
          {isPinned && (
            <span className="qa-pin-indicator" aria-hidden="true">
              <Pin />
            </span>
          )}
          {action.shortcut && <kbd className="qa-row__shortcut">{action.shortcut}</kbd>}
          <button
            type="button"
            className="qa-pin-toggle"
            aria-label={isPinned ? `Unpin ${action.label}` : `Pin ${action.label}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(action.id)
            }}
          >
            {isPinned ? <PinOff /> : <Pin />}
          </button>
        </span>
      </li>
    )
  }

  function renderGroupRow(row: Extract<Row, { kind: 'group' }>, index: number): JSX.Element {
    const isSelected = index === highlight
    return (
      <li
        key={row.id}
        data-row-id={row.id}
        role="option"
        aria-selected={isSelected}
        className={`qa-row${isSelected ? ' qa-row--selected' : ''}`}
        onMouseEnter={() => setHighlight(index)}
        onMouseDown={(e) => {
          e.preventDefault()
          activateRow(row)
        }}
      >
        {renderKeyLabel(row.group.mnemonic)}
        <span className="qa-row__main">
          <span className="qa-row__label">{row.group.label}</span>
        </span>
        <span className="qa-row__end">
          <ChevronRight className="qa-row__chevron" />
        </span>
      </li>
    )
  }

  function renderRow(row: Row, index: number, list: Row[]): JSX.Element {
    return row.kind === 'group' ? renderGroupRow(row, index) : renderActionRow(row, index, list)
  }

  function renderSection(
    label: string,
    rows: Row[],
    indexOffset: number,
    className?: string
  ): JSX.Element | null {
    if (rows.length === 0) return null
    return (
      <React.Fragment>
        <div className="qa-section-label">{label}</div>
        <ul
          className={`qa-list${className ? ` ${className}` : ''}`}
          role="listbox"
          aria-label={label}
        >
          {rows.map((row, i) => renderRow(row, indexOffset + i, topRows))}
        </ul>
      </React.Fragment>
    )
  }

  const headerContext = contextLabel ? <span className="qa-chip">{contextLabel}</span> : null

  return (
    <div className="qa-overlay" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="qa-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Quick actions"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {mode === 'search' ? (
          <div className="qa-top">
            <div className="qa-search">
              <span className="qa-key">/</span>
              <input
                ref={inputRef}
                className="qa-search__input"
                role="combobox"
                aria-label="Search quick actions"
                aria-expanded={searchRows.length > 0}
                aria-controls="qa-search-list"
                aria-autocomplete="list"
                aria-activedescendant={searchRows[highlight]?.id}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
        ) : (
          <div className="qa-top">
            <div className="qa-crumbs">
              <span className="qa-crumbs__link">Quick actions</span>
              {mode === 'group' && currentGroup && (
                <>
                  <span aria-hidden="true">›</span>
                  <span className="qa-crumbs__current">{currentGroup.label}</span>
                  {renderKeyLabel(currentGroup.mnemonic)}
                </>
              )}
              {mode === 'top' && headerContext}
            </div>
          </div>
        )}

        <div className="qa-body">
          {mode === 'top' && (
            <>
              {contextGroupId &&
                groupById.get(contextGroupId) &&
                renderSection(`${groupById.get(contextGroupId)!.label} · here`, contextRows, 0)}
              {renderSection('Pinned & recent', pinnedRecentRows, contextRows.length)}
              {renderSection(
                'Groups',
                groupRows,
                contextRows.length + pinnedRecentRows.length,
                'qa-list--cols'
              )}
              {renderSection(
                'Go',
                goRows,
                contextRows.length + pinnedRecentRows.length + groupRows.length,
                'qa-list--cols'
              )}
            </>
          )}

          {mode === 'group' && (
            <ul className="qa-list" role="listbox" aria-label={currentGroup?.label ?? 'Group'}>
              {groupActionRows.map((row, i) => renderRow(row, i, groupActionRows))}
            </ul>
          )}

          {mode === 'search' && (
            <ul className="qa-list" id="qa-search-list" role="listbox" aria-label="Search results">
              {searchRows.map((row, i) => renderRow(row, i, searchRows))}
            </ul>
          )}
        </div>

        <div className="qa-footer" role="status">
          {statusMessage ? (
            <span className="qa-footer__message">{statusMessage}</span>
          ) : mode === 'search' ? (
            <span className="qa-footer__hint">
              <kbd>↑↓</kbd> move · <kbd>↵</kbd> run · <kbd>esc</kbd> close
            </span>
          ) : (
            <span className="qa-footer__hint">
              <kbd>a–z</kbd> run · <kbd>/</kbd> search · <kbd>⌫</kbd> back · <kbd>⌘.</kbd> pin ·{' '}
              <kbd>esc</kbd> close
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
