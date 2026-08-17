import React, { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import type { PilotState } from '../types/speckit.types.js'
import { RunDashboard } from './RunDashboard.js'
import { CardBriefEditor } from './CardBriefEditor.js'
import { ActivityFeed } from './ActivityFeed.js'
import { ArtifactsPanel } from './ArtifactsPanel.js'
import { LaneStrip } from './LaneStrip.js'

type Tab = 'brief' | 'phases' | 'activity' | 'artifacts'
const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'phases', label: 'Phases' },
  { id: 'activity', label: 'Activity' },
  { id: 'artifacts', label: 'Artifacts' },
]

interface CardDetailProps {
  featureDir: string
  workspacePath: string
  onClose: () => void
}

export function CardDetail({ featureDir, workspacePath, onClose }: CardDetailProps) {
  const [tab, setTab] = useState<Tab>('brief')
  const [state, setState] = useState<PilotState | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [baseBranch, setBaseBranch] = useState<string>('')
  const [quickMode, setQuickMode] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const load = useCallback(async () => {
    const result = await getSpeckitAPI().pilotState({ featureDir })
    if ('state' in result) {
      setState(result.state)
      setQuickMode(result.state.mode === 'quick')
    }
  }, [featureDir])

  useEffect(() => {
    void load()
  }, [load])

  // Load the workspace's branches so the user can pick a base for a new feature.
  useEffect(() => {
    if (!workspacePath) return
    void (async () => {
      try {
        const res = await window.electronAPI.git.listBranches(workspacePath)
        const local = (res.branches ?? []).filter((b) => !b.isRemote)
        setBranches(local.map((b) => b.name))
        const current = local.find((b) => b.isCurrent)?.name
        setBaseBranch(current ?? local[0]?.name ?? 'main')
      } catch {
        setBranches([])
        setBaseBranch('main')
      }
    })()
  }, [workspacePath])

  const saveBrief = useCallback(
    async (brief: {
      title: string
      type: PilotState['card']['type']
      scope: string
      checklist: PilotState['card']['checklist']
    }) => {
      await getSpeckitAPI().cardUpdate({ featureDir, brief })
      void load()
    },
    [featureDir, load]
  )

  // The gate refuses a start when unreviewed diffs are waiting. Refusing
  // silently would read as a button that does nothing, so the reason is shown
  // and the override is offered next to it — one click, and recorded.
  const [refusal, setRefusal] = useState<string | null>(null)

  const handoff = useCallback(
    async (overrideBackpressure = false) => {
      const result = await getSpeckitAPI().cardHandoff({
        featureDir,
        workspacePath,
        baseBranch: baseBranch || undefined,
        mode: quickMode ? 'quick' : 'speckit',
        overrideBackpressure,
      })
      if ('error' in result) {
        // Any failure, not just the gate: a validation error or a worktree that
        // could not be made used to clear the banner and reload as though the
        // card had started.
        setRefusal(
          result.error === 'backpressure'
            ? (('reason' in result ? result.reason : null) ??
                'Diffs are waiting to be reviewed — no new run will start until one is.')
            : 'message' in result && typeof result.message === 'string'
              ? result.message
              : `Could not start this card: ${result.error}`
        )
        return
      }
      setRefusal(null)
      void load()
    },
    [featureDir, workspacePath, baseBranch, quickMode, load]
  )

  const reset = useCallback(async () => {
    setConfirmingReset(false)
    await getSpeckitAPI().cardReset({ featureDir, workspacePath })
    void load()
  }, [featureDir, workspacePath, load])

  // "Actively running" means a phase is genuinely in progress — not just a stale
  // run flag (e.g. after a reload the in-memory runner is gone). Base the handoff
  // affordance on that so a dead/stuck run can always be (re)started.
  const isRunning = state ? Object.values(state.phases).some((p) => p.status === 'running') : false
  const hasRun = state !== null && state.run !== null
  const canHandoff = state !== null && !isRunning && state.run?.status !== 'completed'

  return (
    <div className="sk-card-detail" role="dialog" aria-label="Card detail">
      <header className="sk-card-detail__head">
        <h2>{state?.card.title ?? 'Card'}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <nav className="sk-card-detail__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sk-tab${tab === t.id ? ' sk-tab--active' : ''}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sk-card-detail__body">
        {tab === 'brief' &&
          (state ? (
            <CardBriefEditor initial={state.card} submitLabel="Save brief" onSubmit={saveBrief} />
          ) : (
            <p>Loading…</p>
          ))}
        {tab === 'phases' && (
          <>
            {/* A card that touches more than one repository, in merge order.
                Renders nothing for the single-repository case. */}
            <LaneStrip featureDir={featureDir} />
            {canHandoff && (
              <div className="sk-startcard">
                <p className="sk-startcard__status">
                  {hasRun
                    ? 'This card is not currently running.'
                    : 'This card has not been started yet.'}
                </p>
                {!state?.worktreePath && (
                  <label className="sk-field">
                    <span>Base branch</span>
                    <select
                      aria-label="Base branch"
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                    >
                      {branches.length === 0 && <option value="main">main</option>}
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="sk-toggle">
                  <input
                    type="checkbox"
                    checked={quickMode}
                    onChange={(e) => setQuickMode(e.target.checked)}
                  />
                  <span className="sk-toggle__text">
                    <strong>Quick fix</strong>
                    <span className="sk-toggle__hint">
                      plan → implement → review · skips full SpecKit
                    </span>
                  </span>
                </label>
                <div className="sk-startcard__actions">
                  <button
                    type="button"
                    className="sk-btn sk-btn--primary"
                    onClick={() => void handoff()}
                  >
                    {hasRun ? 'Resume / re-run' : 'Hand off to agent'}
                  </button>
                </div>
                {refusal !== null && (
                  <div className="sk-sup__warn" role="alert">
                    {refusal}
                    <button
                      type="button"
                      className="sk-sup__btn"
                      onClick={() => void handoff(true)}
                    >
                      Start anyway
                    </button>
                  </div>
                )}
              </div>
            )}
            {hasRun && (
              <div className="sk-reset">
                {confirmingReset ? (
                  <>
                    <span className="sk-reset__warn">
                      Delete this run&apos;s worktree, branch, and history?
                    </span>
                    <button type="button" className="sk-btn sk-btn--danger" onClick={reset}>
                      Reset everything
                    </button>
                    <button
                      type="button"
                      className="sk-btn sk-btn--ghost"
                      onClick={() => setConfirmingReset(false)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="sk-btn sk-btn--ghost"
                    onClick={() => setConfirmingReset(true)}
                  >
                    Reset / start over
                  </button>
                )}
              </div>
            )}
            {hasRun && <RunDashboard featureDir={featureDir} workspacePath={workspacePath} />}
          </>
        )}
        {tab === 'activity' && <ActivityFeed featureDir={featureDir} />}
        {tab === 'artifacts' && <ArtifactsPanel featureDir={featureDir} />}
      </div>
    </div>
  )
}
