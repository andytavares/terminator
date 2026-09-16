import React, { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { WallTile } from './WallTile'
import { useIssueTitles, useSessionFacts } from '../session/useSessionFacts'
import { useMetricsStore } from '../../stores/metrics.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { navigateToSession } from '../../terminal/navigate-to-session'
import { resumeSession } from '../../terminal/start-session'
import { answersFor } from '../session/answers'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
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
import './OverviewScreen.css'

const SIZES: Array<{ value: TileSize; label: string; short: string }> = [
  { value: 's', label: 'Small', short: 'S' },
  { value: 'm', label: 'Medium', short: 'M' },
  { value: 'l', label: 'Large', short: 'L' },
]

const THEN_BY: Array<{ value: WallThenBy; label: string }> = [
  { value: 'state', label: 'State' },
  { value: 'workspace-project', label: 'Repo and branch' },
  { value: 'recent', label: 'Recent activity' },
]

/**
 * The Monitor wall: every open terminal as a tile large enough to read.
 *
 * Sessions that need the operator are pinned double-width at the top. Every
 * tile, and both band headings, are direct children of one grid and are placed
 * by CSS `order` — see placeWall for why a tile must never be re-parented.
 */
export function OverviewScreen(): JSX.Element {
  const facts = useSessionFacts()
  const titles = useIssueTitles()
  const setDescription = useSessionRecordsStore((s) => s.setDescription)
  const { processesBySessionId, startPolling, stopPolling } = useMetricsStore()

  const [prefs, setPrefs] = useState<WallPrefs>(loadWallPrefs)
  const [text, setText] = useState('')
  const [linking, setLinking] = useState<SessionFacts | null>(null)

  function update(patch: Partial<WallPrefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      saveWallPrefs(next)
      return next
    })
  }

  const open = useMemo(() => facts.filter((f) => !f.isClosed), [facts])
  const shown = useMemo(
    () => open.filter((f) => matchesFilter(f, text, titles)),
    [open, text, titles]
  )
  const wall = useMemo(() => placeWall(shown, prefs), [shown, prefs])
  const factsById = new Map(shown.map((f) => [f.sessionId, f]))
  const hasRest = wall.placements.length > wall.needsCount
  const now = Date.now()

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

  function saveDescription(target: SessionFacts, description: string | null): void {
    void setDescription(target.snapshot, description)
  }

  return (
    <div className="wall">
      <div className="wall__bar">
        <h2 className="wall__title">Overview</h2>
        <span className="wall__meta">
          {open.length} live {open.length === 1 ? 'terminal' : 'terminals'}
        </span>
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
        <button
          type="button"
          role="switch"
          aria-checked={prefs.pinNeeds}
          className="wall__toggle"
          onClick={() => update({ pinNeeds: !prefs.pinNeeds })}
        >
          Pin sessions that need you
        </button>
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

      <div className="wall__body">
        {open.length === 0 ? (
          <div className="wall__empty">
            <p>No terminals are open</p>
            <button
              type="button"
              className="wall__empty-action"
              onClick={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
            >
              Go to terminals
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="wall__empty">
            <p>No sessions match</p>
            <button type="button" className="wall__empty-action" onClick={() => setText('')}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="wall__grid" data-size={prefs.size}>
            {wall.needsCount > 0 && (
              <h3 className="wall__band" style={{ order: 0 }}>
                Needs you
              </h3>
            )}
            {wall.needsCount > 0 && hasRest && (
              <h3 className="wall__band" style={{ order: wall.needsCount + 1 }}>
                Everything else
              </h3>
            )}
            {wall.placements.map((placement) => (
              <WallTile
                key={placement.sessionId}
                facts={factsById.get(placement.sessionId)!}
                placement={placement}
                metrics={processesBySessionId.get(placement.sessionId) ?? null}
                now={now}
                onOpen={navigateToSession}
                onSaveDescription={saveDescription}
                onLink={setLinking}
                onResume={(facts) => void resumeSession(facts)}
                answers={answersFor(factsById.get(placement.sessionId)!)}
              />
            ))}
          </div>
        )}
      </div>
      {linking !== null && <SessionLinkDialog facts={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}
