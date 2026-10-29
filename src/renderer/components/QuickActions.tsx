import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Pin, PinOff } from 'lucide-react'
import { ModalShell } from '@terminator/extension-ui'
import type { QuickAction, QuickActionGroup } from '../quick-actions/types'
import { searchActions } from '../quick-actions/search'
import { orderGroups } from '../quick-actions/rank'
import { handleQuickActionKey, type KeyContext } from './quick-action-keys'
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

export type Row =
  | { kind: 'action'; id: string; action: QuickAction; keyLabel: string; groupLabel?: string }
  | { kind: 'group'; id: string; group: QuickActionGroup }

type ActionRow = Extract<Row, { kind: 'action' }>
type GroupRow = Extract<Row, { kind: 'group' }>

export type Mode = 'top' | 'group' | 'search'

function actionRow(action: QuickAction, keyLabel: string, groupLabel?: string): Row {
  return { kind: 'action', id: `action:${action.id}`, action, keyLabel, groupLabel }
}

function groupRow(group: QuickActionGroup): Row {
  return { kind: 'group', id: `group:${group.id}`, group }
}

/** "g p": the group's letter, then the action's. */
function chord(group: QuickActionGroup, action: QuickAction): string {
  return `${group.mnemonic} ${action.mnemonic ?? ''}`.trim()
}

export function QuickActions(props: QuickActionsProps): React.JSX.Element {
  const panel = usePanelState(props)
  const { inputRef, panelRef } = usePanelFocus(panel.mode)
  const rows = usePanelRows(props, panel)
  useHighlightInView(panelRef, panel.highlight, rows.visible)
  useQuickActionKeys(props, panel, rows)

  return (
    <ModalShell label="Quick actions" className="qa-panel" onDismiss={props.onClose}>
      <div ref={panelRef} className="qa-panel__frame" tabIndex={-1}>
        <PanelHeader {...props} panel={panel} rows={rows} inputRef={inputRef} />
        <PanelBody {...props} panel={panel} rows={rows} />
        <PanelFooter mode={panel.mode} statusMessage={panel.statusMessage} />
      </div>
    </ModalShell>
  )
}

/** Where the panel is (top, a group, or search), what is highlighted, and moving between them. */
function usePanelState({ searchSignal, onRun }: QuickActionsProps) {
  const { mode, groupId, statusMessage, setStatusMessage, go } = useNavigation()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const enterSearch = (): void => {
    go('search', groupId)
    setQuery('')
  }
  useSearchSignal(searchSignal, () => {
    enterSearch()
    setHighlight(0)
  })
  useHighlightReset({ mode, groupId, query }, () => setHighlight(0))
  return {
    mode,
    groupId,
    query,
    setQuery,
    highlight,
    setHighlight,
    statusMessage,
    enterSearch,
    backToTop: () => go('top'),
    openGroup: (group: QuickActionGroup) => go('group', group.id),
    activate: (row: Row | undefined) => activateRow(row, { go, setStatusMessage, onRun }),
  }
}

type PanelState = ReturnType<typeof usePanelState>

/** The mode and open group, and the status line that a move clears. */
function useNavigation() {
  const [mode, setMode] = useState<Mode>('top')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const go = (next: Mode, group: string | null = null): void => {
    setMode(next)
    setGroupId(group)
    setStatusMessage(null)
  }
  return { mode, groupId, statusMessage, setStatusMessage, go }
}

interface Activation {
  go: (next: Mode, group?: string | null) => void
  setStatusMessage: (message: string | null) => void
  onRun: (action: QuickAction) => void
}

/** A group row opens its group; a disabled action says why; any other action runs. */
function activateRow(row: Row | undefined, { go, setStatusMessage, onRun }: Activation): void {
  if (!row) return
  if (row.kind === 'group') return go('group', row.group.id)
  if (row.action.disabledReason) return setStatusMessage(row.action.disabledReason)
  setStatusMessage(null)
  onRun(row.action)
}

/** Each new `searchSignal` (⌘P pressed again while open) switches to an empty search. */
function useSearchSignal(searchSignal: number | undefined, toSearch: () => void): void {
  const prevSearchSignal = useRef(searchSignal)
  const toSearchRef = useRef(toSearch)
  useEffect(() => {
    toSearchRef.current = toSearch
  })
  useEffect(() => {
    if (searchSignal !== undefined && searchSignal !== prevSearchSignal.current) {
      prevSearchSignal.current = searchSignal
      toSearchRef.current()
    }
  }, [searchSignal])
}

/** The highlight goes back to the first row whenever what is listed changes. */
function useHighlightReset(
  view: { mode: Mode; groupId: string | null; query: string },
  reset: () => void
) {
  const [highlightedFor, setHighlightedFor] = useState(view)
  if (
    highlightedFor.mode !== view.mode ||
    highlightedFor.groupId !== view.groupId ||
    highlightedFor.query !== view.query
  ) {
    setHighlightedFor(view)
    reset()
  }
}

/** Focus follows the mode: the search box while searching, else the panel's frame, from mount.
 * Left where the dialog opens it, on a row's pin button, Enter and Space would press that button
 * as well as run the highlighted row. */
function usePanelFocus(mode: Mode) {
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode === 'search') inputRef.current?.focus()
  }, [mode])
  useEffect(() => {
    if (mode !== 'search') panelRef.current?.focus()
  }, [mode])
  return { inputRef, panelRef }
}

/** Every list the panel can show, and the one it shows now. */
function usePanelRows(props: QuickActionsProps, panel: PanelState) {
  const { groups, actions } = props
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const top = useTopRows(props, groupById)
  const openGroupRows = useMemo<Row[]>(() => {
    if (!panel.groupId) return []
    return actions
      .filter((a) => a.group === panel.groupId)
      .map((a) => actionRow(a, a.mnemonic ?? ''))
  }, [panel.groupId, actions])
  const searchRows = useMemo<Row[]>(() => {
    if (panel.mode !== 'search') return []
    return searchActions(actions, groups, panel.query).map((a) =>
      actionRow(a, '', groupById.get(a.group)?.label)
    )
  }, [panel.mode, panel.query, actions, groups, groupById])
  const visible = { top: top.all, group: openGroupRows, search: searchRows }[panel.mode]
  return { groupById, ...top, openGroupRows, searchRows, visible }
}

type PanelRows = ReturnType<typeof usePanelRows>

/** The top level: the context group's actions, pinned and recent, every group, then Go. */
function useTopRows(props: QuickActionsProps, groupById: Map<string, QuickActionGroup>) {
  const { groups, actions, pinned, recent, contextGroupId } = props
  const context = useMemo<Row[]>(() => {
    const group = contextGroupId ? groupById.get(contextGroupId) : undefined
    if (!group) return []
    return actions.filter((a) => a.group === group.id).map((a) => actionRow(a, chord(group, a)))
  }, [contextGroupId, groupById, actions])
  const pinnedRecent = useMemo<Row[]>(
    () => [...pinned, ...recent].map((a) => pinnedRow(a, groupById)),
    [pinned, recent, groupById]
  )
  const groupRows = useMemo<Row[]>(
    () => orderGroups(groups, contextGroupId).map(groupRow),
    [groups, contextGroupId]
  )
  const go = useMemo<Row[]>(
    () => actions.filter((a) => a.group === 'top').map((a) => actionRow(a, a.mnemonic ?? '')),
    [actions]
  )
  const all = useMemo(
    () => [...context, ...pinnedRecent, ...groupRows, ...go],
    [context, pinnedRecent, groupRows, go]
  )
  return { context, pinnedRecent, groupRows, go, all }
}

/** A pinned or recent action, keyed by its chord and named with its group. */
function pinnedRow(action: QuickAction, groupById: Map<string, QuickActionGroup>): Row {
  if (action.group === 'top') return actionRow(action, action.mnemonic ?? '')
  const group = groupById.get(action.group)
  const keyLabel = group ? chord(group, action) : (action.mnemonic ?? '')
  return actionRow(action, keyLabel, group?.label)
}

/** Keeps the highlighted row scrolled into view. */
function useHighlightInView(
  panelRef: React.RefObject<HTMLDivElement | null>,
  highlight: number,
  visible: Row[]
): void {
  useEffect(() => {
    const row = visible[highlight]
    if (!row) return
    const el = panelRef.current?.querySelector(`[data-row-id="${row.id}"]`)
    ;(el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, visible, panelRef])
}

/** Listens on the window, so keys reach the panel wherever focus is; reads the latest state. */
function useQuickActionKeys(props: QuickActionsProps, panel: PanelState, rows: PanelRows): void {
  const context: KeyContext = {
    ...panel,
    rows: rows.visible,
    goRows: rows.go,
    groups: props.groups,
    onTogglePin: props.onTogglePin,
    onClose: props.onClose,
  }
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  })
  useEffect(() => {
    const dispatchKey = (e: KeyboardEvent): void => handleQuickActionKey(e, contextRef.current)
    window.addEventListener('keydown', dispatchKey)
    return () => window.removeEventListener('keydown', dispatchKey)
  }, [])
}

interface PanelPartProps extends QuickActionsProps {
  panel: PanelState
  rows: PanelRows
}

type HeaderProps = PanelPartProps & { inputRef: React.RefObject<HTMLInputElement | null> }

/** The search box while searching; else where you are, and the context chip at the top. */
function PanelHeader({ panel, rows, contextLabel, inputRef }: HeaderProps): React.JSX.Element {
  if (panel.mode === 'search') {
    return <SearchBox panel={panel} results={rows.searchRows} inputRef={inputRef} />
  }
  const group = panel.groupId ? rows.groupById.get(panel.groupId) : undefined
  return (
    <div className="qa-top">
      <div className="qa-crumbs">
        <span className="qa-crumbs__link">Quick actions</span>
        {panel.mode === 'group' && group && (
          <>
            <span aria-hidden="true">›</span>
            <span className="qa-crumbs__current">{group.label}</span>
            <KeyLabel keyLabel={group.mnemonic} />
          </>
        )}
        {panel.mode === 'top' && contextLabel && <span className="qa-chip">{contextLabel}</span>}
      </div>
    </div>
  )
}

interface SearchBoxProps {
  panel: PanelState
  results: Row[]
  inputRef: React.RefObject<HTMLInputElement | null>
}

function SearchBox({ panel, results, inputRef }: SearchBoxProps): React.JSX.Element {
  return (
    <div className="qa-top">
      <div className="qa-search">
        <span className="qa-key">/</span>
        <input
          ref={inputRef}
          className="qa-search__input"
          role="combobox"
          aria-label="Search quick actions"
          aria-expanded={results.length > 0}
          aria-controls="qa-search-list"
          aria-autocomplete="list"
          aria-activedescendant={results[panel.highlight]?.id}
          value={panel.query}
          onChange={(e) => panel.setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

/** The top level's sections, a group's actions, or the search results. */
function PanelBody(props: PanelPartProps): React.JSX.Element {
  const { panel, rows } = props
  const rowProps = { panel, pins: props.pins, onTogglePin: props.onTogglePin }
  return (
    <div className="qa-body">
      {panel.mode === 'top' && <TopSections {...props} />}
      {panel.mode === 'group' && (
        <ul
          className="qa-list"
          role="listbox"
          aria-label={rows.groupById.get(panel.groupId ?? '')?.label ?? 'Group'}
        >
          <RowList rows={rows.openGroupRows} offset={0} {...rowProps} />
        </ul>
      )}
      {panel.mode === 'search' && (
        <ul className="qa-list" id="qa-search-list" role="listbox" aria-label="Search results">
          <RowList rows={rows.searchRows} offset={0} {...rowProps} />
        </ul>
      )}
    </div>
  )
}

/** Each top-level section in order, numbering its rows on from the section before. */
function TopSections({ panel, rows, pins, onTogglePin, contextGroupId }: PanelPartProps) {
  const contextGroup = contextGroupId ? rows.groupById.get(contextGroupId) : undefined
  const sections = withOffsets([
    [contextGroup ? `${contextGroup.label} · here` : '', rows.context],
    ['Pinned & recent', rows.pinnedRecent],
    ['Groups', rows.groupRows, 'qa-list--cols'],
    ['Go', rows.go, 'qa-list--cols'],
  ])
  return (
    <>
      {sections.map(([label, list, className, start]) => {
        if (list.length === 0) return null
        return (
          <React.Fragment key={label}>
            <div className="qa-section-label">{label}</div>
            <ul
              className={`qa-list${className ? ` ${className}` : ''}`}
              role="listbox"
              aria-label={label}
            >
              <RowList rows={list} offset={start} {...{ panel, pins, onTogglePin }} />
            </ul>
          </React.Fragment>
        )
      })}
    </>
  )
}

type Section = [label: string, rows: Row[], className?: string]

/** Each section with the index its first row has in the highlight order. */
function withOffsets(sections: Section[]): Array<[string, Row[], string | undefined, number]> {
  const starts = sections.map((_, i) =>
    sections.slice(0, i).reduce((sum, [, rows]) => sum + rows.length, 0)
  )
  return sections.map(([label, rows, className], i) => [label, rows, className, starts[i]])
}

interface RowListProps {
  rows: Row[]
  /** Where these rows start in the list the highlight moves through. */
  offset: number
  panel: PanelState
  pins: string[]
  onTogglePin: (id: string) => void
}

function RowList({ rows, offset, panel, pins, onTogglePin }: RowListProps): React.JSX.Element {
  return (
    <>
      {rows.map((row, i) => {
        const index = offset + i
        const common = {
          selected: index === panel.highlight,
          onHover: () => panel.setHighlight(index),
          onActivate: () => panel.activate(row),
        }
        return row.kind === 'group' ? (
          <GroupRowItem key={row.id} row={row} {...common} />
        ) : (
          <ActionRowItem
            key={row.id}
            row={row}
            {...common}
            pinned={pins.includes(row.action.id)}
            onTogglePin={onTogglePin}
          />
        )
      })}
    </>
  )
}

/** Always rendered, empty for an action with no mnemonic: `.qa-row` is a 3-column grid (`24px
 * 1fr auto`), and without it the label landed in the 24px key column, clipped to a letter. */
function KeyLabel({ keyLabel }: { keyLabel: string }): React.JSX.Element {
  if (!keyLabel) return <span className="qa-key qa-key--empty" aria-hidden="true" />
  return <span className={`qa-key${keyLabel.length > 1 ? ' qa-key--wide' : ''}`}>{keyLabel}</span>
}

interface RowItemProps {
  selected: boolean
  onHover: () => void
  onActivate: () => void
  className?: string
  children: React.ReactNode
  id: string
}

/** One option: highlighted on hover, activated on press (before focus can move). */
function RowItem({ selected, onHover, onActivate, className = '', children, id }: RowItemProps) {
  return (
    <li
      data-row-id={id}
      role="option"
      aria-selected={selected}
      className={`qa-row${selected ? ' qa-row--selected' : ''}${className}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault()
        onActivate()
      }}
    >
      {children}
    </li>
  )
}

type ItemProps<R> = Omit<RowItemProps, 'children' | 'id' | 'className'> & { row: R }

function GroupRowItem({ row, ...item }: ItemProps<GroupRow>): React.JSX.Element {
  return (
    <RowItem id={row.id} {...item}>
      <KeyLabel keyLabel={row.group.mnemonic} />
      <span className="qa-row__main">
        <span className="qa-row__label">{row.group.label}</span>
      </span>
      <span className="qa-row__end">
        <ChevronRight className="qa-row__chevron" />
      </span>
    </RowItem>
  )
}

interface ActionItemProps extends ItemProps<ActionRow> {
  pinned: boolean
  onTogglePin: (id: string) => void
}

function ActionRowItem({ row, pinned, onTogglePin, ...item }: ActionItemProps): React.JSX.Element {
  const { action } = row
  return (
    <RowItem id={row.id} className={action.disabledReason ? ' qa-row--disabled' : ''} {...item}>
      <KeyLabel keyLabel={row.keyLabel} />
      <span className="qa-row__main">
        {row.groupLabel && <span className="qa-row__group">{row.groupLabel} ·</span>}
        <span className="qa-row__label">{action.label}</span>
        {action.description && !action.disabledReason && (
          <span className="qa-row__desc">{action.description}</span>
        )}
        {action.disabledReason && <span className="qa-row__reason">{action.disabledReason}</span>}
      </span>
      <ActionRowEnd action={action} pinned={pinned} onTogglePin={onTogglePin} />
    </RowItem>
  )
}

interface ActionRowEndProps {
  action: QuickAction
  pinned: boolean
  onTogglePin: (id: string) => void
}

/** The pin mark, the shortcut, and the pin toggle, which leaves the row alone. */
function ActionRowEnd({ action, pinned, onTogglePin }: ActionRowEndProps): React.JSX.Element {
  return (
    <span className="qa-row__end">
      {pinned && (
        <span className="qa-pin-indicator" aria-hidden="true">
          <Pin />
        </span>
      )}
      {action.shortcut && <kbd className="qa-row__shortcut">{action.shortcut}</kbd>}
      <button
        type="button"
        className="qa-pin-toggle"
        aria-label={pinned ? `Unpin ${action.label}` : `Pin ${action.label}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin(action.id)
        }}
      >
        {pinned ? <PinOff /> : <Pin />}
      </button>
    </span>
  )
}

/** Why an action did not run, else the keys this mode answers to. */
function PanelFooter({ mode, statusMessage }: { mode: Mode; statusMessage: string | null }) {
  return (
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
  )
}
