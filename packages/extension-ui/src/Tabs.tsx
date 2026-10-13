import React, { createContext, useContext, useId, useLayoutEffect, useState } from 'react'
import './extension-ui.css'

/* WAI-ARIA tabs with automatic activation (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
 * Built from parts, as Radix and React Aria tabs are, so a tab list can share a toolbar row and
 * its panels render where the caller puts them; `Tabs` assembles them as a list over its panel. */

export type TabOrientation = 'horizontal' | 'vertical'

interface TabsContextValue {
  baseId: string
  selectedId: string
  onSelect: (id: string) => void
  shownPanelId: string | null
  setShownPanelId: React.Dispatch<React.SetStateAction<string | null>>
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(part: string): TabsContextValue {
  const context = useContext(TabsContext)
  if (!context) throw new Error(`${part} must be inside a TabsRoot`)
  return context
}

const tabElementId = (baseId: string, id: string) => `${baseId}-tab-${id}`
const panelElementId = (baseId: string, id: string) => `${baseId}-panel-${id}`

export interface TabsRootProps<Id extends string = string> {
  selectedId: Id
  onSelect: (id: Id) => void
  children: React.ReactNode
}

/** Holds the selection. Draws no element, so it does not change the caller's layout. */
export function TabsRoot<Id extends string = string>({
  selectedId,
  onSelect,
  children,
}: TabsRootProps<Id>): JSX.Element {
  const baseId = useId()
  const [shownPanelId, setShownPanelId] = useState<string | null>(null)
  // Every id that comes back is one the caller gave a Tab, so it is an Id.
  const select = onSelect as (id: string) => void
  const value = { baseId, selectedId, onSelect: select, shownPanelId, setShownPanelId }
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
}

type Move = 'previous' | 'next' | 'first' | 'last'

const MOVES: Record<TabOrientation, Record<string, Move>> = {
  horizontal: { ArrowLeft: 'previous', ArrowRight: 'next', Home: 'first', End: 'last' },
  vertical: { ArrowUp: 'previous', ArrowDown: 'next', Home: 'first', End: 'last' },
}

function targetIndex(move: Move, count: number, current: number): number {
  if (move === 'first') return 0
  if (move === 'last') return count - 1
  const step = move === 'next' ? 1 : -1
  return (current + step + count) % count
}

function enabledTabs(list: HTMLElement): HTMLButtonElement[] {
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
}

export interface TabListProps {
  /** Names the tab list for assistive technology: "Pull request sections". */
  label: string
  /** Vertical lists move with Up and Down instead of Left and Right. */
  orientation?: TabOrientation
  className?: string
  children: React.ReactNode
}

export function TabList({
  label,
  orientation = 'horizontal',
  className,
  children,
}: TabListProps): JSX.Element {
  const { onSelect } = useTabsContext('TabList')
  const moveFocusByKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const move = MOVES[orientation][event.key]
    const tabs = enabledTabs(event.currentTarget)
    const current = tabs.indexOf(event.target as HTMLButtonElement)
    if (!move || current < 0) return
    event.preventDefault()
    const next = tabs[targetIndex(move, tabs.length, current)]
    next.focus()
    onSelect(next.dataset.tabId ?? '')
  }
  const classes = ['tmui-tabs__list', className].filter(Boolean).join(' ')
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={classes}
      onKeyDown={moveFocusByKey}
    >
      {children}
    </div>
  )
}

export interface TabProps {
  id: string
  disabled?: boolean
  /** The tab's name when its content is more than words, such as a count: "Needs you, 3" for
   * `Needs you<span>3</span>`, which would otherwise be read as "Needs you3". */
  accessibleName?: string
  className?: string
  children: React.ReactNode
}

export function Tab({ id, disabled, accessibleName, className, children }: TabProps): JSX.Element {
  const { baseId, selectedId, onSelect, shownPanelId } = useTabsContext('Tab')
  const selected = id === selectedId
  const classes = ['tmui-tabs__tab', className].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      role="tab"
      id={tabElementId(baseId, id)}
      data-tab-id={id}
      aria-label={accessibleName}
      aria-selected={selected}
      // Only the shown panel is in the document; a reference to another would dangle.
      aria-controls={selected && shownPanelId === id ? panelElementId(baseId, id) : undefined}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={classes}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  )
}

export interface TabPanelProps {
  /** The `id` of the tab this panel belongs to. Rendered only while that tab is selected. */
  id: string
  className?: string
  children: React.ReactNode
}

export function TabPanel({ id, className, children }: TabPanelProps): JSX.Element | null {
  const { baseId, selectedId, setShownPanelId } = useTabsContext('TabPanel')
  const shown = id === selectedId
  useLayoutEffect(() => {
    if (!shown) return undefined
    setShownPanelId(id)
    return () => setShownPanelId((current) => (current === id ? null : current))
  }, [shown, id, setShownPanelId])
  if (!shown) return null
  const classes = ['tmui-tabs__panel', className].filter(Boolean).join(' ')
  return (
    <div
      role="tabpanel"
      id={panelElementId(baseId, id)}
      aria-labelledby={tabElementId(baseId, id)}
      tabIndex={0}
      className={classes}
    >
      {children}
    </div>
  )
}

export interface TabItem {
  id: string
  /** Words, or markup such as a count; give markup an `accessibleName`. */
  label: React.ReactNode
  accessibleName?: string
  disabled?: boolean
  panel: React.ReactNode
}

export interface TabsProps {
  /** Names the tab list for assistive technology: "Pull request sections". */
  label: string
  tabs: readonly TabItem[]
  selectedId: string
  onSelect: (id: string) => void
}

/** A tab list directly over its panel. For any other layout, use the parts. */
export function Tabs({ label, tabs, selectedId, onSelect }: TabsProps): JSX.Element {
  return (
    <TabsRoot selectedId={selectedId} onSelect={onSelect}>
      <div className="tmui-tabs">
        <TabList label={label}>
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              id={tab.id}
              disabled={tab.disabled}
              accessibleName={tab.accessibleName}
            >
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {tabs.map((tab) => (
          <TabPanel key={tab.id} id={tab.id}>
            {tab.panel}
          </TabPanel>
        ))}
      </div>
    </TabsRoot>
  )
}
