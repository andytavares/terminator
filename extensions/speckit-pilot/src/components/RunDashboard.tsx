import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Square } from 'lucide-react'
import type { PhaseId, PilotState } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'
import { PhaseRail } from './PhaseRail.js'
import { RunConsole } from './RunConsole.js'
import { GatePanel } from './GatePanel.js'
import { SelfReviewGate } from './SelfReviewGate.js'
import { OpenPrGate } from './OpenPrGate.js'
import { BatchCheckIn } from './BatchCheckIn.js'

interface RunDashboardProps {
  featureDir: string
  workspacePath: string
  onBack?: () => void
}

function findAwaitingPhase(state: PilotState): PhaseId | null {
  for (const id of PHASE_ORDER) {
    if (state.phases[id]?.status === 'awaiting_review') return id
  }
  return null
}

function findRunningPhase(state: PilotState): PhaseId | undefined {
  for (const id of PHASE_ORDER) {
    if (state.phases[id]?.status === 'running') return id
  }
  return undefined
}

interface CheckinReadyData {
  featureDir: string
  batchIndex: number
  diffSummary: string
}

export function RunDashboard({ featureDir, workspacePath, onBack }: RunDashboardProps) {
  const [state, setState] = useState<PilotState | null>(null)
  const [linesByPhase, setLinesByPhase] = useState<Partial<Record<string, string[]>>>({})
  const [viewingPhase, setViewingPhase] = useState<PhaseId | null>(null)
  const [gateContent, setGateContent] = useState<string | null>(null)
  const [gateComments, setGateComments] = useState<Array<{ note: string; ts: string }>>([])
  const [checkinData, setCheckinData] = useState<CheckinReadyData | null>(null)
  const [stopping, setStopping] = useState(false)
  const unsubRef = useRef<Array<() => void>>([])
  const emittedOutputKeysRef = useRef<Set<string>>(new Set())
  const loadedLogsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    emittedOutputKeysRef.current = new Set()
    const api = getSpeckitAPI()

    async function load() {
      const result = await api.pilotState({ featureDir })
      if ('state' in result) {
        setState(result.state)
      }
    }
    void load()

    const unsubState = api.onStateChanged((data) => {
      const payload = data as { state?: PilotState }
      if (payload.state && payload.state.featureDir === featureDir) {
        setState(payload.state)
        setCheckinData(null)
      }
    })

    const unsubOutput = api.onRunOutput((data) => {
      if (data.featureDir === featureDir && data.phase) {
        const key = `${data.ts}|${data.phase}|${data.line}`
        if (emittedOutputKeysRef.current.has(key)) return
        emittedOutputKeysRef.current.add(key)
        const ph = data.phase
        setLinesByPhase((prev) => ({
          ...prev,
          [ph]: [...(prev[ph] ?? []), data.line],
        }))
      }
    })

    const unsubCheckin = api.onCheckinReady((data) => {
      if (data.featureDir === featureDir) {
        setCheckinData(data)
      }
    })

    unsubRef.current = [unsubState, unsubOutput, unsubCheckin]
    return () => {
      unsubRef.current.forEach((fn) => fn())
    }
  }, [featureDir])

  useEffect(() => {
    if (!state) return
    const awaitingPhase = findAwaitingPhase(state)
    if (!awaitingPhase) {
      setGateContent(null)
      setGateComments([])
      return
    }
    const api = getSpeckitAPI()
    const phaseState = state.phases[awaitingPhase]
    const artifactPath = phaseState?.artifactPaths?.[0]
    if (artifactPath) {
      api
        .artifactRead({ filePath: artifactPath, featureDir })
        .then((result) => {
          if ('current' in result) setGateContent(result.current)
        })
        .catch(() => {})
    } else {
      setGateContent(null)
    }
    api
      .historyLoad({ featureDir })
      .then((result) => {
        if ('entries' in result) {
          const comments = result.entries
            .filter((e) => e.phase === awaitingPhase && e.action === 'comment' && e.note)
            .map((e) => ({ note: e.note!, ts: e.ts }))
          setGateComments(comments)
        }
      })
      .catch(() => {})
  }, [state, featureDir])

  async function handleApprove(phase: PhaseId) {
    const api = getSpeckitAPI()
    const result = await api.phaseApprove({ featureDir, phase })
    if ('state' in result) setState(result.state)
  }

  async function handleRequestChanges(phase: PhaseId, note: string) {
    const api = getSpeckitAPI()
    const result = await api.phaseRequestChanges({ featureDir, phase, note })
    if ('state' in result) setState(result.state)
  }

  async function handleRevoke(phase: PhaseId) {
    const api = getSpeckitAPI()
    const result = await api.phaseRevoke({ featureDir, phase })
    if ('state' in result) setState(result.state)
  }

  async function handleComment(phase: PhaseId, note: string) {
    const api = getSpeckitAPI()
    await api.phaseComment({ featureDir, phase, note })
  }

  async function handleStop(deleteWorktree = false) {
    setStopping(true)
    try {
      const api = getSpeckitAPI()
      const result = await api.runCancel({ featureDir, workspacePath, deleteWorktree })
      if ('state' in result && result.state) setState(result.state)
    } finally {
      setStopping(false)
    }
  }

  async function handleInlineEdit(phase: PhaseId, content: string) {
    const api = getSpeckitAPI()
    const phaseState = state?.phases[phase]
    const artifactPath = phaseState?.artifactPaths?.[0]
    if (!artifactPath) return
    await api.fileWrite({ filePath: artifactPath, content })
    const result = await api.phaseApprove({ featureDir, phase, note: 'modified' })
    if ('state' in result) setState(result.state)
  }

  const awaitingPhase = state ? findAwaitingPhase(state) : null
  const activePhase = state ? findRunningPhase(state) : undefined
  const isRunActive = state?.run?.status === 'running'
  const displayPhase = viewingPhase ?? activePhase

  // Load persisted output for a phase being reviewed (not the live-streaming one).
  useEffect(() => {
    if (!displayPhase || displayPhase === activePhase) return
    if (loadedLogsRef.current.has(displayPhase)) return
    loadedLogsRef.current.add(displayPhase)
    const ph = displayPhase
    void getSpeckitAPI()
      .runOutputRead({ featureDir, phase: ph })
      .then((r) => {
        if ('lines' in r && r.lines.length > 0) {
          setLinesByPhase((prev) => (prev[ph]?.length ? prev : { ...prev, [ph]: r.lines }))
        }
      })
      .catch(() => {})
  }, [displayPhase, activePhase, featureDir])
  // When no specific phase is selected and no phase is running yet (brief gap),
  // show all accumulated output so lines from the new phase aren't hidden.
  const displayLines = displayPhase
    ? (linesByPhase[displayPhase] ?? [])
    : Object.values(linesByPhase).flat()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 12,
        padding: 16,
        overflow: 'hidden',
      }}
    >
      {/* Back button + phase rail + stop button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onBack && (
          <button
            aria-label="Back to runs list"
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              fontSize: 12,
              background: 'transparent',
              color: 'var(--tm-text-secondary)',
              border: '1px solid var(--tm-border)',
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={12} />
          </button>
        )}
        {state && (
          <PhaseRail
            phases={state.phases}
            activePhase={activePhase}
            selectedPhase={viewingPhase ?? undefined}
            onSelectPhase={(id) => setViewingPhase(id === viewingPhase ? null : id)}
          />
        )}
        {isRunActive && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              aria-label="Stop run"
              onClick={() => void handleStop(false)}
              disabled={stopping}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                fontSize: 12,
                background: 'var(--tm-error-bg, #450a0a)',
                color: 'var(--tm-error, #f87171)',
                border: '1px solid var(--tm-error, #f87171)',
                borderRadius: 6,
                cursor: stopping ? 'not-allowed' : 'pointer',
                opacity: stopping ? 0.6 : 1,
              }}
            >
              <Square size={12} />
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
            <button
              aria-label="Stop and delete worktree"
              onClick={() => void handleStop(true)}
              disabled={stopping}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                fontSize: 12,
                background: 'transparent',
                color: 'var(--tm-error, #f87171)',
                border: '1px solid var(--tm-error, #f87171)',
                borderRadius: 6,
                cursor: stopping ? 'not-allowed' : 'pointer',
                opacity: stopping ? 0.6 : 1,
              }}
            >
              Stop + cleanup
            </button>
          </div>
        )}
      </div>

      {/* Console */}
      <RunConsole featureDir={featureDir} lines={displayLines} phase={displayPhase} />

      {/* Self-review gate */}
      {state && awaitingPhase === 'self-review' && <SelfReviewGate featureDir={featureDir} />}

      {/* Open PR gate */}
      {state && awaitingPhase === 'open-pr' && (
        <OpenPrGate featureDir={featureDir} workspacePath={workspacePath} />
      )}

      {/* Batch check-in banner */}
      {checkinData && (
        <BatchCheckIn
          featureDir={featureDir}
          batchIndex={checkinData.batchIndex}
          diffSummary={checkinData.diffSummary}
        />
      )}

      {/* Generic gate panel for all other phases awaiting review */}
      {state && awaitingPhase && awaitingPhase !== 'self-review' && awaitingPhase !== 'open-pr' && (
        <GatePanel
          featureDir={featureDir}
          phase={awaitingPhase}
          phaseState={state.phases[awaitingPhase]}
          artifactContent={gateContent}
          comments={gateComments}
          onApprove={() => handleApprove(awaitingPhase)}
          onRequestChanges={(note) => handleRequestChanges(awaitingPhase, note)}
          onRevoke={() => handleRevoke(awaitingPhase)}
          onComment={(note) => handleComment(awaitingPhase, note)}
          onInlineEdit={(content) => handleInlineEdit(awaitingPhase, content)}
        />
      )}
    </div>
  )
}
