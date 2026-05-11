import type { Feature, PhaseId, PilotState } from './speckit.types.js'

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
  phaseRevoke(payload: {
    featureDir: string
    phase: PhaseId
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
    phaseRevoke: (payload) =>
      bridge.invoke('speckit:phase-revoke', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    onStateChanged: (handler) => bridge.on('speckit:state-changed', handler),
  }
}
