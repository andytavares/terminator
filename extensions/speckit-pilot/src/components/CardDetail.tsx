import React, { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import type { PilotState } from '../types/speckit.types.js'
import { RunDashboard } from './RunDashboard.js'
import { CardBriefEditor } from './CardBriefEditor.js'
import { ActivityFeed } from './ActivityFeed.js'
import { ArtifactsPanel } from './ArtifactsPanel.js'

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

  const load = useCallback(async () => {
    const result = await getSpeckitAPI().pilotState({ featureDir })
    if ('state' in result) setState(result.state)
  }, [featureDir])

  useEffect(() => {
    void load()
  }, [load])

  // Load the workspace's branches so the user can pick a base for a new feature.
  useEffect(() => {
    if (!workspacePath) return
    void (async () => {
      try {
        const res = (await window.electronAPI.git.listBranches({ repoRoot: workspacePath })) as {
          branches?: Array<{ name: string; isCurrent?: boolean; isRemote?: boolean }>
        }
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

  const handoff = useCallback(async () => {
    await getSpeckitAPI().cardHandoff({
      featureDir,
      workspacePath,
      baseBranch: baseBranch || undefined,
    })
    void load()
  }, [featureDir, workspacePath, baseBranch, load])

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
            {canHandoff && (
              <div className="sk-handoff">
                <p>
                  {hasRun
                    ? 'This card is not currently running.'
                    : 'This card has not been started yet.'}
                </p>
                {!state?.worktreePath && (
                  <label className="sk-field" style={{ maxWidth: 320 }}>
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
                <button type="button" className="sk-btn sk-btn--primary" onClick={handoff}>
                  {hasRun ? 'Resume / re-run with agent' : 'Hand off to agent'}
                </button>
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
