import React, { useId, useRef } from 'react'
import './extension-ui.css'

export interface TabItem {
  id: string
  label: string
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

type Move = 'previous' | 'next' | 'first' | 'last'

const MOVES: Record<string, Move> = {
  ArrowLeft: 'previous',
  ArrowRight: 'next',
  Home: 'first',
  End: 'last',
}

function targetIndex(move: Move, enabled: readonly number[], current: number): number {
  if (move === 'first') return enabled[0]
  if (move === 'last') return enabled[enabled.length - 1]
  const step = move === 'next' ? 1 : -1
  return enabled[(enabled.indexOf(current) + step + enabled.length) % enabled.length]
}

function useTabKeys(tabs: readonly TabItem[], onSelect: (id: string) => void) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const register = (index: number) => (element: HTMLButtonElement | null) => {
    buttons.current[index] = element
  }
  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const move = MOVES[event.key]
    const enabled = tabs.flatMap((tab, i) => (tab.disabled ? [] : [i]))
    if (!move || enabled.length === 0) return
    event.preventDefault()
    const next = targetIndex(move, enabled, index)
    buttons.current[next]?.focus()
    onSelect(tabs[next].id)
  }
  return { register, onKeyDown }
}

/**
 * Tabs with automatic activation, as in the WAI-ARIA Authoring Practices
 * tabs pattern: arrow keys move focus and select, Home and End jump to the
 * ends, and only the selected tab is in the Tab order.
 * https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 */
export function Tabs({ label, tabs, selectedId, onSelect }: TabsProps): JSX.Element {
  const baseId = useId()
  const { register, onKeyDown } = useTabKeys(tabs, onSelect)
  const selected = tabs.find((tab) => tab.id === selectedId)

  return (
    <div className="tmui-tabs">
      <div role="tablist" aria-label={label} className="tmui-tabs__list">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={register(index)}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab === selected}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab === selected ? 0 : -1}
            disabled={tab.disabled}
            className="tmui-tabs__tab"
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {selected && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.id}`}
          aria-labelledby={`${baseId}-tab-${selected.id}`}
          tabIndex={0}
          className="tmui-tabs__panel"
        >
          {selected.panel}
        </div>
      )}
    </div>
  )
}
