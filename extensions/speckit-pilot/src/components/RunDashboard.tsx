import React, { useEffect, useRef, useState } from 'react'
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

export function RunDashboard({ featureDir, workspacePath: _workspacePath }: RunDashboardProps) {
  const [state, setState] = useState<PilotState | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [gateContent, setGateContent] = useState<string | null>(null)
  const [checkinData, setCheckinData] = useState<CheckinReadyData | null>(null)
  const unsubRef = useRef<Array<() => void>>([])

  useEffect(() => {
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
      if (data.featureDir === featureDir) {
        setLines((prev) => [...prev, data.line])
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
      {/* Phase rail */}
      {state && <PhaseRail phases={state.phases} activePhase={activePhase} />}

      {/* Console */}
      <RunConsole featureDir={featureDir} lines={lines} />

      {/* Self-review gate */}
      {state && awaitingPhase === 'self-review' && <SelfReviewGate featureDir={featureDir} />}

      {/* Open PR gate */}
      {state && awaitingPhase === 'open-pr' && (
        <OpenPrGate featureDir={featureDir} workspacePath={_workspacePath} />
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
