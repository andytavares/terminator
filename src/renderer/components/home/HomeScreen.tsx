import React, { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { LedgerView } from './LedgerView'
import { LogbookView } from './LogbookView'
import { LedgerDisplayMenu } from './LedgerDisplayMenu'
import { NewSessionMenu } from './NewSessionMenu'
import { StateIcon } from '../session/StateIcon'
import { useIssueTitles, useSessionFacts } from '../session/useSessionFacts'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { navigateToSession } from '../../terminal/navigate-to-session'
import { startScratchSession, startSessionInBranch } from '../../terminal/start-session'
import { answersFor } from '../session/answers'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import {
  loadHomePrefs,
  saveHomePrefs,
  type HomeLayout,
  type HomePrefs,
} from '../../sidebar/home-prefs'
import { buildLedger } from '../../sidebar/ledger-rows'
import { buildLogbook } from '../../sidebar/logbook-groups'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'
import './HomeScreen.css'

const LAYOUTS: Array<{ value: HomeLayout; label: string }> = [
  { value: 'ledger', label: 'Ledger' },
  { value: 'logbook', label: 'Logbook' },
]

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
  const setLink = useSessionRecordsStore((s) => s.setLink)

  const [prefs, setPrefs] = useState<HomePrefs>(loadHomePrefs)
  const [text, setText] = useState('')
  const [needsYou, setNeedsYou] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linking, setLinking] = useState<SessionFacts | null>(null)

  const groups = useMemo(
    () => buildLedger(facts, prefs, { needsYou, text }, titles),
    [facts, prefs, needsYou, text, titles]
  )
  const logbook = useMemo(
    () =>
      buildLogbook(
        needsYou ? facts.filter((f) => f.state === 'awaiting-input') : facts,
        text,
        titles
      ),
    [facts, needsYou, text, titles]
  )
  const needsYouCount = facts.filter((f) => f.state === 'awaiting-input').length
  const selected = facts.find((f) => f.sessionId === selectedId) ?? null
  const matches = prefs.layout === 'ledger' ? groups.length : logbook.length

  function update(patch: Partial<HomePrefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      saveHomePrefs(next)
      return next
    })
  }

  const openCount = facts.filter((f) => !f.isClosed).length
  const now = Date.now()

  function saveDescription(target: SessionFacts, description: string | null): void {
    void setDescription(target.snapshot, description)
  }

  function linkIssue(target: SessionFacts, issue: IssueSummary): void {
    void setLink(target.snapshot, { tracker: issue.tracker, key: issue.key })
  }

  return (
    <section className="home" aria-label="Home">
      <div className="home__bar">
        <h2 className="home__title">Home</h2>
        <span className="home__meta">
          {openCount} {openCount === 1 ? 'session' : 'sessions'}
        </span>
        <NewSessionMenu
          onStartInBranch={(projectId) => void startSessionInBranch(projectId)}
          onStartScratch={() => void startScratchSession()}
        />
        <div className="home__layouts" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.value}
              type="button"
              role="radio"
              aria-checked={prefs.layout === layout.value}
              className="home__layout"
              onClick={() => update({ layout: layout.value })}
            >
              {layout.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={needsYou}
          className="home__toggle"
          onClick={() => setNeedsYou((v) => !v)}
        >
          <StateIcon state="awaiting-input" />
          Needs you
          <span className="home__count">{needsYouCount}</span>
        </button>
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
        {prefs.layout === 'ledger' && <LedgerDisplayMenu prefs={prefs} onChange={update} />}
      </div>

      <div className="home__body">
        {openCount === 0 && (
          <div className="home__empty">
            <p>No terminals are open</p>
            <div className="home__empty-actions">
              <NewSessionMenu
                onStartInBranch={(projectId) => void startSessionInBranch(projectId)}
                onStartScratch={() => void startScratchSession()}
              />
              <button
                type="button"
                className="home__empty-action"
                onClick={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
              >
                Go to terminals
              </button>
            </div>
          </div>
        )}

        {facts.length > 0 && matches === 0 ? (
          <div className="home__empty">
            <p>No sessions match</p>
            <button
              type="button"
              className="home__empty-action"
              onClick={() => {
                setText('')
                setNeedsYou(false)
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          matches > 0 &&
          (prefs.layout === 'logbook' ? (
            <LogbookView
              groups={logbook}
              selected={selected}
              titles={titles}
              now={now}
              onSelect={setSelectedId}
              onOpen={navigateToSession}
              onSaveDescription={saveDescription}
              onLinkIssue={linkIssue}
              onLink={setLinking}
              renderAnswers={answersFor}
            />
          ) : (
            <LedgerView
              groups={groups}
              columns={prefs.columns}
              previewSelected={prefs.previewSelected}
              selectedId={selectedId}
              now={now}
              onSelect={setSelectedId}
              onOpen={navigateToSession}
              onSaveDescription={saveDescription}
              onLink={setLinking}
              renderAnswers={answersFor}
            />
          ))
        )}
      </div>
      {linking !== null && <SessionLinkDialog facts={linking} onClose={() => setLinking(null)} />}
    </section>
  )
}
