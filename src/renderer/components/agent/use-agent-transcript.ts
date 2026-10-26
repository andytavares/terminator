import { useEffect, useState } from 'react'
import type { AgentPermissionAsk, AgentUpdate } from '@terminator/extension-sdk'
import { emptyTranscript, foldUpdates, type Transcript } from './fold-updates'

export interface AgentTranscriptState {
  transcript: Transcript
  asks: AgentPermissionAsk[]
  exited: boolean
}

/** The updates a session has had so far, then each one as it arrives. */
function useTranscript(sessionId: string): Transcript {
  const [transcript, setTranscript] = useState(emptyTranscript)
  useEffect(() => {
    const api = window.electronAPI.agents
    let loaded = false
    const early: AgentUpdate[] = []
    const unsubscribe = api.onUpdate((payload) => {
      if (payload.sessionId !== sessionId) return
      if (loaded) setTranscript((current) => foldUpdates(current, payload.update))
      else early.push(payload.update)
    })
    void api.history({ sessionId }).then((reply) => {
      const history = 'data' in reply ? reply.data : []
      loaded = true
      setTranscript([...history, ...early].reduce(foldUpdates, emptyTranscript))
    })
    return unsubscribe
  }, [sessionId])
  return transcript
}

/** The asks waiting on a person: the open ones, those that arrive, minus those settled. */
function useOpenAsks(sessionId: string): AgentPermissionAsk[] {
  const [asks, setAsks] = useState<AgentPermissionAsk[]>([])
  useEffect(() => {
    const api = window.electronAPI.agents
    const add = (ask: AgentPermissionAsk): void =>
      setAsks((current) =>
        current.some((a) => a.requestId === ask.requestId) ? current : [...current, ask]
      )
    void api.openAsks().then((reply) => {
      if ('data' in reply) reply.data.filter((a) => a.sessionId === sessionId).forEach(add)
    })
    const stopAsks = api.onPermission((p) => p.sessionId === sessionId && add(p.ask))
    const stopSettled = api.onPermissionSettled((p) => {
      if (p.sessionId === sessionId)
        setAsks((current) => current.filter((a) => a.requestId !== p.requestId))
    })
    return () => {
      stopAsks()
      stopSettled()
    }
  }, [sessionId])
  return asks
}

function useExited(sessionId: string): boolean {
  const [exited, setExited] = useState(false)
  useEffect(
    () => window.electronAPI.agents.onEnd((p) => p.sessionId === sessionId && setExited(true)),
    [sessionId]
  )
  return exited
}

export function useAgentTranscript(sessionId: string): AgentTranscriptState {
  return {
    transcript: useTranscript(sessionId),
    asks: useOpenAsks(sessionId),
    exited: useExited(sessionId),
  }
}
