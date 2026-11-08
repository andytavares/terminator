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
    // Electron sends a push and the history's reply down two pipes, so either can arrive first.
    // An update's position in the history says whether the history holds it.
    let next: number | null = null
    const early: Array<{ update: AgentUpdate; position: number }> = []
    const fold = ({ update, position }: { update: AgentUpdate; position: number }): void => {
      if (next === null || position < next) return
      next = position + 1
      setTranscript((current) => foldUpdates(current, update))
    }
    const unsubscribe = api.onUpdate((payload) => {
      if (payload.sessionId !== sessionId) return
      if (next === null) early.push(payload)
      else fold(payload)
    })
    void api.history({ sessionId }).then((reply) => {
      const history = 'data' in reply ? reply.data : []
      next = history.length
      setTranscript(history.reduce(foldUpdates, emptyTranscript))
      early.forEach(fold)
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

/** The follow-up messages waiting for the turn to end; changing them tells main. */
export function useFollowUpQueue(sessionId: string): [string[], (messages: string[]) => void] {
  const [messages, setMessages] = useState<string[]>([])
  useEffect(() => {
    // The queue lives in main; a tab that opens later reads what is there, then follows changes.
    void window.electronAPI.agents.queueGet({ sessionId }).then((answer) => {
      if ('data' in answer) setMessages(answer.data)
    })
    return window.electronAPI.agents.onQueueChanged((p) => {
      if (p.sessionId === sessionId) setMessages(p.messages)
    })
  }, [sessionId])
  const change = (next: string[]): void => {
    setMessages(next)
    void window.electronAPI.agents.queueSet({ sessionId, messages: next })
  }
  return [messages, change]
}
