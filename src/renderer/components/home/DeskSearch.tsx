import React, { forwardRef } from 'react'
import { Search } from 'lucide-react'
import { Kbd } from '@terminator/extension-ui'
import { useDeskFilter } from './desk-filter'
import { searchWork, type SearchHit } from './desk-search'
import { useDeskSelection } from './desk-selection'
import { useMyTickets } from './start-work-model'
import { useStartWorkStore } from './start-work'
import { useWorkThreads } from './useWorkThreads'
import { useSessionFacts } from '../session/useSessionFacts'
import './DeskSearch.css'
import { revealSession } from '../../terminal/navigate-to-session'
import { recordUse } from '../../usage/record'

/** Does what picking the hit means: open the thread, show the session, or start work on the ticket. */
function openHit(hit: SearchHit): void {
  if (hit.kind === 'thread') useDeskSelection.getState().openThread(hit.key)
  if (hit.kind === 'session') revealSession(hit.sessionId)
  if (hit.kind === 'ticket') useStartWorkStore.getState().openLauncher(hit.issue.key)
}

/** The search box and, under it, what matches; the last row starts work on what was typed. */
export const DeskSearch = forwardRef<HTMLInputElement>(function DeskSearch(_props, ref) {
  const text = useDeskFilter((s) => s.text)
  const hits = searchWork({
    text,
    threads: useWorkThreads().threads,
    facts: useSessionFacts(),
    tickets: useMyTickets(),
  })
  const pick = (hit: SearchHit | null): void => {
    recordUse('core.home.search')
    if (hit) openHit(hit)
    else useStartWorkStore.getState().openLauncher(text.trim())
    useDeskFilter.getState().clear()
  }
  return (
    <div className="hd__search-wrap">
      <SearchBox ref={ref} text={text} onEnter={() => pick(hits[0] ?? null)} />
      {text.trim() !== '' && <DeskSearchResults text={text} hits={hits} onPick={pick} />}
    </div>
  )
})

const SearchBox = forwardRef<HTMLInputElement, { text: string; onEnter: () => void }>(
  function SearchBox({ text, onEnter }, ref) {
    return (
      <label className="desk-field hd__search">
        <Search aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          aria-label="Search work"
          placeholder="Search work, or type to start…"
          value={text}
          onChange={(event) => useDeskFilter.getState().setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text.trim() !== '') onEnter()
            if (event.key === 'Escape') useDeskFilter.getState().setText('')
          }}
        />
        <Kbd>⌘K</Kbd>
      </label>
    )
  }
)

interface DeskSearchResultsProps {
  text: string
  hits: SearchHit[]
  onPick: (hit: SearchHit | null) => void
}

function DeskSearchResults(props: DeskSearchResultsProps): JSX.Element {
  const { text, hits, onPick } = props
  return (
    <ul className="hd__results" role="listbox" aria-label="Search results">
      {hits.map((hit) => (
        <li key={`${hit.kind}:${hit.detail}:${hit.label}`} role="option" aria-selected={false}>
          <button type="button" onClick={() => onPick(hit)}>
            <span>{hit.label}</span>
            <small>{hit.detail}</small>
          </button>
        </li>
      ))}
      <li role="option" aria-selected={false}>
        <button type="button" onClick={() => onPick(null)}>
          Start work on “{text.trim()}”
        </button>
      </li>
    </ul>
  )
}
