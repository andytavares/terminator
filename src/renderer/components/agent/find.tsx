import React, { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import { recordUse } from '../../usage/record'
import type { Transcript, TranscriptEntry } from './fold-updates'

export interface FindState {
  query: string
  current: number
}

export const noFind: FindState = { query: '', current: 0 }

/** The text with each case-insensitive match of the query marked; `current` is the global index. */
export function Highlighted(props: {
  text: string
  query: string
  first: number
  current: number
}): React.ReactNode {
  const { text, query } = props
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'i'))
  let index = props.first
  return parts.map((part, i) => {
    if (i % 2 === 0) return part
    const cls = index === props.current ? ' agent-find__match--current' : ''
    return (
      <mark key={i} className={`agent-find__match${cls}`} data-index={index++}>
        {part}
      </mark>
    )
  })
}

export const countMatches = (text: string, query: string): number =>
  query ? text.toLowerCase().split(query.toLowerCase()).length - 1 : 0

/** For each message, the global index of its first match. */
export function firstMatches(
  entries: TranscriptEntry[],
  query: string
): Map<TranscriptEntry, number> {
  const first = new Map<TranscriptEntry, number>()
  let seen = 0
  for (const entry of entries) {
    if (entry.kind !== 'message') continue
    first.set(entry, seen)
    seen += countMatches(entry.text, query)
  }
  return first
}

export interface FindControls {
  find: FindState | null
  total: number
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  move: (step: 1 | -1) => void
}

/** The find bar's state: the query, the current match, and how many there are. */
export function useFind(transcript: Transcript): FindControls {
  const [find, setFind] = useState<FindState | null>(null)
  const total = find
    ? transcript.entries.reduce(
        (sum, e) => sum + (e.kind === 'message' ? countMatches(e.text, find.query) : 0),
        0
      )
    : 0
  return {
    find,
    total,
    open: () => {
      recordUse('core.agent.find', 'shortcut')
      setFind((f) => f ?? noFind)
    },
    close: () => setFind(null),
    setQuery: (query) => setFind({ query, current: 0 }),
    move: (step) =>
      setFind((f) => f && { ...f, current: total === 0 ? 0 : (f.current + step + total) % total }),
  }
}

function onFindKey(e: React.KeyboardEvent, { move, close }: FindControls): void {
  if (e.key === 'Escape') close()
  if (e.key !== 'Enter') return
  e.preventDefault()
  move(e.shiftKey ? -1 : 1)
}

export function FindBar(props: { find: FindState; controls: FindControls }): React.JSX.Element {
  const { find, controls } = props
  const position = controls.total === 0 ? 0 : find.current + 1
  return (
    <div className="agent-find" role="search">
      <input
        autoFocus
        aria-label="Find in the transcript"
        className="agent-find__input"
        value={find.query}
        onChange={(e) => controls.setQuery(e.target.value)}
        onKeyDown={(e) => onFindKey(e, controls)}
      />
      <span className="agent-find__count">{`${position} of ${controls.total}`}</span>
      <IconButton icon={ChevronUp} label="Previous match" onClick={() => controls.move(-1)} />
      <IconButton icon={ChevronDown} label="Next match" onClick={() => controls.move(1)} />
      <IconButton icon={X} label="Close find" onClick={controls.close} />
    </div>
  )
}
