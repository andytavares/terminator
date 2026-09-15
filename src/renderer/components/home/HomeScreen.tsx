import React, { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { LedgerView } from './LedgerView'
import { useIssueTitles, useSessionFacts } from '../session/useSessionFacts'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { navigateToSession } from '../../terminal/navigate-to-session'
import { loadHomePrefs } from '../../sidebar/home-prefs'
import { buildLedger } from '../../sidebar/ledger-rows'
import type { SessionFacts } from '../../sidebar/session-facts'
import './HomeScreen.css'

/**
 * The launch view: every session, where it lives, and what it is for.
 *
 * Filters are held here and never persisted — opening Home narrowed to
 * yesterday's search would read as sessions having gone missing.
 */
export function HomeScreen(): JSX.Element {
  const facts = useSessionFacts()
  const titles = useIssueTitles()
  const setDescription = useSessionRecordsStore((s) => s.setDescription)

  const [prefs] = useState(loadHomePrefs)
  const [text, setText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const groups = useMemo(
    () => buildLedger(facts, prefs, { needsYou: false, text }, titles),
    [facts, prefs, text, titles]
  )

  const openCount = facts.filter((f) => !f.isClosed).length
  const now = Date.now()

  function saveDescription(target: SessionFacts, description: string | null): void {
    void setDescription(target.snapshot, description)
  }

  return (
    <div className="home">
      <div className="home__bar">
        <h2 className="home__title">Home</h2>
        <span className="home__meta">
          {openCount} {openCount === 1 ? 'session' : 'sessions'}
        </span>
        <label className="home__search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Filter sessions"
            placeholder="Filter sessions"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>

      <div className="home__body">
        {openCount === 0 && (
          <div className="home__empty">
            <p>No terminals are open</p>
            <button
              type="button"
              className="home__empty-action"
              onClick={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
            >
              Go to terminals
            </button>
          </div>
        )}

        {facts.length > 0 && groups.length === 0 ? (
          <div className="home__empty">
            <p>No sessions match</p>
            <button type="button" className="home__empty-action" onClick={() => setText('')}>
              Clear filters
            </button>
          </div>
        ) : (
          groups.length > 0 && (
            <LedgerView
              groups={groups}
              columns={prefs.columns}
              previewSelected={prefs.previewSelected}
              selectedId={selectedId}
              now={now}
              onSelect={setSelectedId}
              onOpen={navigateToSession}
              onSaveDescription={saveDescription}
            />
          )
        )}
      </div>
    </div>
  )
}
