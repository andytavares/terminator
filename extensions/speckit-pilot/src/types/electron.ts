import type { Feature, HistoryEntry, PhaseId, PilotState } from './speckit.types.js'

export interface SpeckitAPI {
  featureList(payload: { repoRoot: string }): Promise<{ features: Feature[] } | { error: string }>
  checkArtifacts(payload: {
    featureDir: string
    repoRoot: string
  }): Promise<{ exists: Record<string, boolean> } | { error: string }>
  fileWrite(payload: {
    filePath: string
    content: string
  }): Promise<{ ok: true } | { error: string }>
  pilotState(payload: {
    featureDir: string
  }): Promise<{ state: PilotState } | { error: string } | { notFound: true }>
  phaseApprove(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseReject(payload: {
    featureDir: string
    phase: PhaseId
    reason: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseRevoke(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  artifactRead(payload: {
    filePath: string
    featureDir?: string
    repoRoot?: string
  }): Promise<{ current: string | null; approved: string | null } | { error: string }>
  historyLoad(payload: {
    featureDir: string
  }): Promise<{ entries: HistoryEntry[] } | { error: string }>
  sessionList(): Promise<{ sessions: { id: string; name: string }[] }>
  implementStop(payload: {
    featureDir: string
    phase?: PhaseId
  }): Promise<{ ok: true } | { error: string }>
  checkpointCreate(payload: {
    featureDir: string
    repoRoot?: string
  }): Promise<{ commitHash: string } | { error: string }>
  implementFileDecision(payload: {
    filePath: string
    decision: 'approve' | 'skip'
    featureDir: string
    repoRoot?: string
  }): Promise<{ ok: true } | { error: string }>
  phaseSkip(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseUnskip(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  onStateChanged(handler: (data: unknown) => void): () => void
}

export function getSpeckitAPI(): SpeckitAPI {
  const bridge = window.electronAPI.extensionBridge
  return {
    featureList: (payload) =>
      bridge.invoke('speckit:feature-list', payload) as Promise<
        { features: Feature[] } | { error: string }
      >,
    checkArtifacts: (payload) =>
      bridge.invoke('speckit:check-artifacts', payload) as Promise<
        { exists: Record<string, boolean> } | { error: string }
      >,
    fileWrite: (payload) =>
      bridge.invoke('speckit:file-write', payload) as Promise<{ ok: true } | { error: string }>,
    pilotState: (payload) =>
      bridge.invoke('speckit:pilot-state', payload) as Promise<
        { state: PilotState } | { error: string } | { notFound: true }
      >,
    phaseApprove: (payload) =>
      bridge.invoke('speckit:phase-approve', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseReject: (payload) =>
      bridge.invoke('speckit:phase-reject', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseRevoke: (payload) =>
      bridge.invoke('speckit:phase-revoke', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    artifactRead: (payload) =>
      bridge.invoke('speckit:artifact-read', payload) as Promise<
        { current: string | null; approved: string | null } | { error: string }
      >,
    historyLoad: (payload) =>
      bridge.invoke('speckit:history-load', payload) as Promise<
        { entries: HistoryEntry[] } | { error: string }
      >,
    sessionList: () =>
      bridge.invoke('speckit:session-list', {}) as Promise<{
        sessions: { id: string; name: string }[]
      }>,
    implementStop: (payload) =>
      bridge.invoke('speckit:implement-stop', payload) as Promise<{ ok: true } | { error: string }>,
    checkpointCreate: (payload) =>
      bridge.invoke('speckit:checkpoint-create', payload) as Promise<
        { commitHash: string } | { error: string }
      >,
    implementFileDecision: (payload) =>
      bridge.invoke('speckit:implement-file-decision', payload) as Promise<
        { ok: true } | { error: string }
      >,
    phaseSkip: (payload) =>
      bridge.invoke('speckit:phase-skip', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseUnskip: (payload) =>
      bridge.invoke('speckit:phase-unskip', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    onStateChanged: (handler) => bridge.on('speckit:state-changed', handler),
  }
}
