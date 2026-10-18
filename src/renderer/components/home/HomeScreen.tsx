import React, { useCallback, useMemo, useState } from 'react'
import { Command, Search } from 'lucide-react'
import { LedgerView } from './LedgerView'
import { LogbookView } from './LogbookView'
import { LedgerDisplayMenu } from './LedgerDisplayMenu'
import { NewSessionMenu } from '../session/NewSessionMenu'
import { StateChip } from '../session/StateChip'
import { useIssueTitles, useSessionFacts } from '../session/useSessionFacts'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { FrameHeightReadyContext } from '../fit-content-height'
import { startScratchSession, startSessionInBranch } from '../../terminal/start-session'
import { SESSION_ACTIONS } from '../session/session-actions'
import { answersFor } from '../session/answers'
import { useNow } from '../session/useNow'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import {
  loadHomePrefs,
  saveHomePrefs,
  type HomeLayout,
  type HomePrefs,
} from '../../sidebar/home-prefs'
import { buildLedger, type LedgerQuery } from '../../sidebar/ledger-rows'
import { buildLogbook } from '../../sidebar/logbook-groups'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'
import '../screen-chrome.css'
import './HomeScreen.css'

const LAYOUTS: Array<{ value: HomeLayout; label: string }> = [
  { value: 'ledger', label: 'Ledger' },
  { value: 'logbook', label: 'Logbook' },
]

export interface HomeScreenProps {
  onOpenQuickActions?: () => void
}

/**
 * The launch view: every session, where it lives, and what it is for.
 *
 * Filters are held here and never persisted — opening Home narrowed to
 * yesterday's search would read as sessions having gone missing.
 */
export function HomeScreen({ onOpenQuickActions }: HomeScreenProps = {}): JSX.Element {
  const facts = useSessionFacts()
  const [prefs, update] = useHomePrefs()
  const filters = useHomeFilters(facts, prefs)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linking, setLinking] = useState<SessionFacts | null>(null)
  const openCount = facts.filter((f) => !f.isClosed).length

  return (
    <section className="home" aria-label="Home">
      <HomeBar {...{ openCount, prefs, update, filters, onOpenQuickActions }} />
      <HomeBody>
        {openCount === 0 && <NothingOpen />}
        {facts.length > 0 && filters.matches === 0 ? (
          <NoMatches onClear={filters.clear} />
        ) : (
          filters.matches > 0 && (
            <HomeLayout
              {...{ facts, prefs, filters, selectedId }}
              onSelect={setSelectedId}
              onLink={setLinking}
            />
          )
        )}
      </HomeBody>
      {linking !== null && <SessionLinkDialog facts={linking} onClose={() => setLinking(null)} />}
    </section>
  )
}

/** Held hidden until every section has a height, so the sessions under them never jump. */
function HomeBody({ children }: { children: React.ReactNode }): JSX.Element {
  const homeSections = useExtensionRegistry((s) => s.homeSections)
  const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set())
  const markReady = useCallback((extensionId: string) => {
    setReadyIds((ids) => (ids.has(extensionId) ? ids : new Set(ids).add(extensionId)))
  }, [])
  const holding = [...homeSections.keys()].some((id) => !readyIds.has(id))
  return (
    <div className="home__body" data-holding={holding || undefined}>
      <FrameHeightReadyContext.Provider value={markReady}>
        <ContributedHomeSections homeSections={homeSections} />
      </FrameHeightReadyContext.Provider>
      {children}
    </div>
  )
}

type HomeSections = ReturnType<typeof useExtensionRegistry.getState>['homeSections']

/** Each extension's homeSection, in registration order, above the sessions. */
function ContributedHomeSections({ homeSections }: { homeSections: HomeSections }) {
  if (homeSections.size === 0) return null
  return (
    <>
      {[...homeSections.values()].map((section) => (
        <section key={section.id} aria-label={section.label} className="home__section">
          <section.component />
        </section>
      ))}
    </>
  )
}

/** Home's arrangement, saved as it changes. */
function useHomePrefs(): [HomePrefs, (patch: Partial<HomePrefs>) => void] {
  const [prefs, setPrefs] = useState<HomePrefs>(loadHomePrefs)
  function update(patch: Partial<HomePrefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      saveHomePrefs(next)
      return next
    })
  }
  return [prefs, update]
}

/** The filter text and the Needs you toggle, and what each layout shows under them. */
function useHomeFilters(facts: SessionFacts[], prefs: HomePrefs) {
  const titles = useIssueTitles()
  const [text, setText] = useState('')
  const [needsYou, setNeedsYou] = useState(false)
  const { groups, logbook } = useHomeRows(facts, prefs, { needsYou, text, titles })
  return {
    titles,
    text,
    setText,
    needsYou,
    setNeedsYou,
    groups,
    logbook,
    matches: prefs.layout === 'ledger' ? groups.length : logbook.length,
    needsYouCount: facts.filter(needsAttention).length,
    clear: (): void => {
      setText('')
      setNeedsYou(false)
    },
  }
}

/** The Ledger's groups and the Logbook's, under the same filters. */
function useHomeRows(facts: SessionFacts[], prefs: HomePrefs, query: LedgerQuery) {
  const { needsYou, text, titles } = query
  const groups = useMemo(
    () => buildLedger(facts, prefs, { needsYou, text, titles }),
    [facts, prefs, needsYou, text, titles]
  )
  const logbook = useMemo(
    () => buildLogbook(needsYou ? facts.filter(needsAttention) : facts, text, titles),
    [facts, needsYou, text, titles]
  )
  return { groups, logbook }
}

type HomeFilters = ReturnType<typeof useHomeFilters>

const needsAttention = (f: SessionFacts): boolean => f.state === 'awaiting-input'

interface HomeBarProps {
  openCount: number
  prefs: HomePrefs
  update: (patch: Partial<HomePrefs>) => void
  filters: HomeFilters
  onOpenQuickActions?: () => void
}

/** The title and count, New terminal, the layout, the filters, Display and Quick actions. */
function HomeBar({ openCount, prefs, update, filters, onOpenQuickActions }: HomeBarProps) {
  return (
    <div className="home__bar">
      <h2 className="home__title">Home</h2>
      <span className="home__meta">
        {openCount} {openCount === 1 ? 'session' : 'sessions'}
      </span>
      <StartSessionMenu />
      <LayoutChoices layout={prefs.layout} update={update} />
      <HomeFilterControls filters={filters} />
      {prefs.layout === 'ledger' && <LedgerDisplayMenu prefs={prefs} onChange={update} />}
      {onOpenQuickActions && <QuickActionsButton onClick={onOpenQuickActions} />}
    </div>
  )
}

function StartSessionMenu(): JSX.Element {
  return (
    <NewSessionMenu
      onStartInBranch={(projectId) => void startSessionInBranch(projectId)}
      onStartScratch={() => void startScratchSession()}
    />
  )
}

interface LayoutChoicesProps {
  layout: HomeLayout
  update: (patch: Partial<HomePrefs>) => void
}

function LayoutChoices({ layout, update }: LayoutChoicesProps): JSX.Element {
  return (
    <div className="home__layouts" role="radiogroup" aria-label="Layout">
      {LAYOUTS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={layout === option.value}
          className="home__layout"
          onClick={() => update({ layout: option.value })}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The Needs you toggle with its count, and the filter box. */
function HomeFilterControls({ filters }: { filters: HomeFilters }): JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-pressed={filters.needsYou}
        className="home__toggle"
        onClick={() => filters.setNeedsYou((v) => !v)}
      >
        <StateChip state="awaiting-input" compact />
        Needs you
        <span className="home__count">{filters.needsYouCount}</span>
      </button>
      <label className="home__search">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="Filter sessions"
          placeholder="Filter sessions"
          value={filters.text}
          onChange={(e) => filters.setText(e.target.value)}
        />
      </label>
    </>
  )
}

function QuickActionsButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="home__quick-actions"
      aria-label="Quick actions (⌘P)"
      onClick={onClick}
    >
      <Command aria-hidden="true" />
      Quick actions
      <kbd className="home__quick-actions-shortcut">⌘P</kbd>
    </button>
  )
}

/** Nothing is open: start a terminal, or go to the terminals. */
function NothingOpen(): JSX.Element {
  return (
    <div className="home__empty">
      <p>No terminals are open</p>
      <div className="home__empty-actions">
        <StartSessionMenu />
        <button
          type="button"
          className="home__empty-action"
          onClick={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
        >
          Go to terminals
        </button>
      </div>
    </div>
  )
}

function NoMatches({ onClear }: { onClear: () => void }): JSX.Element {
  return (
    <div className="home__empty">
      <p>No sessions match</p>
      <button type="button" className="home__empty-action" onClick={onClear}>
        Clear filters
      </button>
    </div>
  )
}

interface HomeLayoutProps {
  facts: SessionFacts[]
  prefs: HomePrefs
  filters: HomeFilters
  selectedId: string | null
  onSelect: (sessionId: string) => void
  onLink: (facts: SessionFacts) => void
}

/** The Logbook or the Ledger, with every session action wired the same way. */
function HomeLayout({ facts, prefs, filters, selectedId, onSelect, onLink }: HomeLayoutProps) {
  const now = useNow()
  const shared = { ...SESSION_ACTIONS, now, onSelect, onLink, renderAnswers: answersFor }
  if (prefs.layout === 'logbook') {
    return (
      <LogbookView
        {...shared}
        groups={filters.logbook}
        selected={facts.find((f) => f.sessionId === selectedId) ?? null}
        titles={filters.titles}
        onLinkIssue={linkIssue}
      />
    )
  }
  return (
    <LedgerView
      {...shared}
      groups={filters.groups}
      columns={prefs.columns}
      previewSelected={prefs.previewSelected}
      selectedId={selectedId}
    />
  )
}

function linkIssue(target: SessionFacts, issue: IssueSummary): void {
  void useSessionRecordsStore
    .getState()
    .setLink(target.snapshot, { tracker: issue.tracker, key: issue.key })
}
