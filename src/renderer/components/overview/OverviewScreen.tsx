import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { WallTile } from './WallTile'
import { useIssueTitles, useSessionFacts } from '../session/useSessionFacts'
import { useMetricsStore } from '../../stores/metrics.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { NewSessionMenu } from '../session/NewSessionMenu'
import { startScratchSession, startSessionInBranch } from '../../terminal/start-session'
import { answersFor } from '../session/answers'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import { useNow } from '../session/useNow'
import { matchesFilter } from '../../sidebar/session-filter'
import { placeWall } from '../../sidebar/wall-order'
import {
  loadWallPrefs,
  saveWallPrefs,
  type TileSize,
  type WallPrefs,
  type WallThenBy,
} from '../../sidebar/wall-prefs'
import type { SessionFacts } from '../../sidebar/session-facts'
import { SESSION_ACTIONS } from '../session/session-actions'
import type { ProcessMetrics } from '../../../shared/types/index'
import '../screen-chrome.css'
import './OverviewScreen.css'

const SIZES: Array<{ value: TileSize; label: string; short: string }> = [
  { value: 's', label: 'Small', short: 'S' },
  { value: 'm', label: 'Medium', short: 'M' },
  { value: 'l', label: 'Large', short: 'L' },
]

const THEN_BY: Array<{ value: WallThenBy; label: string }> = [
  { value: 'state', label: 'State' },
  { value: 'workspace-project', label: 'Repo and branch' },
  { value: 'recent', label: 'Recently opened' },
]

/**
 * The Monitor wall: every open terminal as a tile large enough to read.
 *
 * Sessions that need the operator are pinned double-width at the top. Every
 * tile, and both band headings, are direct children of one grid and are placed
 * by CSS `order` — see placeWall for why a tile must never be re-parented.
 */
export function OverviewScreen(): JSX.Element {
  const [prefs, update] = useWallPrefs()
  const [text, setText] = useState('')
  const [linking, setLinking] = useState<SessionFacts | null>(null)
  const { open, shown } = useWallSessions(text)
  const processes = useWallMetrics(open)

  return (
    <div className="wall">
      <WallBar
        openCount={open.length}
        prefs={prefs}
        update={update}
        text={text}
        setText={setText}
      />
      <WallBody
        open={open}
        shown={shown}
        clearText={() => setText('')}
        grid={{ prefs, processes, onLink: setLinking }}
      />
      {linking !== null && <SessionLinkDialog facts={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}

interface WallBodyProps {
  open: SessionFacts[]
  shown: SessionFacts[]
  clearText: () => void
  grid: Omit<WallGridProps, 'shown'>
}

/** The tiles, or why there are none and the way out. */
function WallBody({ open, shown, clearText, grid }: WallBodyProps): JSX.Element {
  return (
    <div className="wall__body">
      {open.length === 0 ? (
        <WallEmpty
          message="No terminals are open"
          action="Go to terminals"
          onAction={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
        />
      ) : shown.length === 0 ? (
        <WallEmpty message="No sessions match" action="Clear filters" onAction={clearText} />
      ) : (
        <WallGrid shown={shown} {...grid} />
      )}
    </div>
  )
}

/** The open sessions, and those of them the filter text matches. */
function useWallSessions(text: string) {
  const facts = useSessionFacts()
  const titles = useIssueTitles()
  const open = useMemo(() => facts.filter((f) => !f.isClosed), [facts])
  const shown = useMemo(
    () => open.filter((f) => matchesFilter(f, text, titles)),
    [open, text, titles]
  )
  return { open, shown }
}

/** The wall's arrangement, saved as it changes. */
function useWallPrefs(): [WallPrefs, (patch: Partial<WallPrefs>) => void] {
  const [prefs, setPrefs] = useState<WallPrefs>(loadWallPrefs)
  function updatePrefs(patch: Partial<WallPrefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      saveWallPrefs(next)
      return next
    })
  }
  return [prefs, updatePrefs]
}

/** Polls the process load of the open sessions while the wall is up. */
function useWallMetrics(open: SessionFacts[]) {
  const { processesBySessionId, startPolling, stopPolling } = useMetricsStore(
    useShallow((s) => ({
      processesBySessionId: s.processesBySessionId,
      startPolling: s.startPolling,
      stopPolling: s.stopPolling,
    }))
  )
  const sessionIdsKey = open.map((f) => f.sessionId).join(',')
  useEffect(() => {
    if (sessionIdsKey === '') {
      startPolling([])
      return stopPolling
    }
    let cancelled = false
    window.electronAPI.metrics
      .getPids(sessionIdsKey.split(','))
      .then((result) => {
        if (!cancelled) startPolling('data' in result ? result.data : [])
      })
      .catch(() => {
        if (!cancelled) startPolling([])
      })
    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey])
  return processesBySessionId
}

interface WallBarProps {
  openCount: number
  prefs: WallPrefs
  update: (patch: Partial<WallPrefs>) => void
  text: string
  setText: (text: string) => void
}

/** The title and count, New terminal, the arrangement controls and the filter. */
function WallBar({ openCount, prefs, update, text, setText }: WallBarProps): JSX.Element {
  return (
    <div className="wall__bar">
      <h2 className="wall__title">Overview</h2>
      <span className="wall__meta">
        {openCount} live {openCount === 1 ? 'terminal' : 'terminals'}
      </span>
      <NewSessionMenu
        onStartInBranch={(projectId) => void startSessionInBranch(projectId)}
        onStartScratch={() => void startScratchSession()}
      />
      <WallArrangement prefs={prefs} update={update} />
      <label className="wall__search">
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
  )
}

/** Tile size, pinning what needs you, and what orders the rest. */
function WallArrangement({ prefs, update }: Pick<WallBarProps, 'prefs' | 'update'>) {
  return (
    <>
      <SizeChoices prefs={prefs} update={update} />
      <button
        type="button"
        role="switch"
        aria-checked={prefs.pinNeeds}
        className="wall__toggle"
        onClick={() => update({ pinNeeds: !prefs.pinNeeds })}
      >
        Pin sessions that need you
      </button>
      <ThenBySelect prefs={prefs} update={update} />
    </>
  )
}

function SizeChoices({ prefs, update }: Pick<WallBarProps, 'prefs' | 'update'>): JSX.Element {
  return (
    <div className="wall__sizes" role="radiogroup" aria-label="Tile size">
      {SIZES.map((size) => (
        <button
          key={size.value}
          type="button"
          role="radio"
          aria-label={size.label}
          aria-checked={prefs.size === size.value}
          className="wall__size"
          onClick={() => update({ size: size.value })}
        >
          {size.short}
        </button>
      ))}
    </div>
  )
}

function ThenBySelect({ prefs, update }: Pick<WallBarProps, 'prefs' | 'update'>): JSX.Element {
  return (
    <label className="wall__select">
      <span>Then by</span>
      <select
        aria-label="Then by"
        value={prefs.thenBy}
        onChange={(e) => update({ thenBy: e.target.value as WallThenBy })}
      >
        {THEN_BY.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface WallEmptyProps {
  message: string
  action: string
  onAction: () => void
}

function WallEmpty({ message, action, onAction }: WallEmptyProps): JSX.Element {
  return (
    <div className="wall__empty">
      <p>{message}</p>
      <button type="button" className="wall__empty-action" onClick={onAction}>
        {action}
      </button>
    </div>
  )
}

interface WallGridProps {
  shown: SessionFacts[]
  prefs: WallPrefs
  processes: Map<string, ProcessMetrics>
  onLink: (facts: SessionFacts) => void
}

/** The band headings and every tile, as siblings in one grid. */
function WallGrid({ shown, prefs, processes, onLink }: WallGridProps): JSX.Element {
  const wall = useMemo(() => placeWall(shown, prefs), [shown, prefs])
  const factsById = new Map(shown.map((f) => [f.sessionId, f]))
  const now = useNow()
  return (
    <div className="wall__grid" data-size={prefs.size}>
      <BandHeadings
        needsCount={wall.needsCount}
        hasRest={wall.placements.length > wall.needsCount}
      />
      {wall.placements.map((placement) => (
        <WallTile
          key={placement.sessionId}
          facts={factsById.get(placement.sessionId)!}
          placement={placement}
          metrics={processes.get(placement.sessionId) ?? null}
          now={now}
          onLink={onLink}
          answers={answersFor(factsById.get(placement.sessionId)!)}
          {...SESSION_ACTIONS}
        />
      ))}
    </div>
  )
}

/** "Needs you" over the pinned tiles and "Everything else" after them, when both exist. */
function BandHeadings({ needsCount, hasRest }: { needsCount: number; hasRest: boolean }) {
  if (needsCount === 0) return null
  return (
    <>
      <h3 className="wall__band" style={{ order: 0 }}>
        Needs you
      </h3>
      {hasRest && (
        <h3 className="wall__band" style={{ order: needsCount + 1 }}>
          Everything else
        </h3>
      )}
    </>
  )
}
