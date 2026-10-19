import { useEffect, useRef, useState } from 'react'
import type { WorkThread } from '../../home/work-threads'
import type { ThreadSummaryInput } from '../../../shared/schemas/agent-usage.schema'
import { pullRequestOf } from './thread-format'

export type ThreadSummary =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error' }

/** What the model is told: the renderer holds each session's latest line and note, not its transcript. */
export function summaryInputOf(thread: WorkThread): ThreadSummaryInput {
  const pr = pullRequestOf(thread)
  return {
    title: thread.title,
    ...(thread.ticketKey ? { ticketKey: thread.ticketKey } : {}),
    sessions: thread.sessions.map((s) => ({
      sessionId: s.sessionId,
      state: s.state,
      lastAssistantTexts: s.latestLine ? [s.latestLine] : [],
      firstUserPrompt: s.description,
    })),
    ...(pr
      ? {
          pullRequest: {
            number: pr.number,
            isDraft: pr.isDraft,
            checksLine: thread.prChip?.text ?? '',
          },
        }
      : {}),
  }
}

/** Asks again only when the work changes shape, not on every line an agent prints. */
const signatureOf = (thread: WorkThread): string =>
  [
    thread.key,
    thread.prChip?.text,
    ...thread.sessions.map((s) => `${s.sessionId}:${s.state}`),
  ].join('|')

async function fetchSummary(input: ThreadSummaryInput): Promise<ThreadSummary> {
  try {
    const result = await window.electronAPI?.homeThreadSummary?.get(input)
    return result && 'text' in result ? { status: 'ready', text: result.text } : { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

const LOADING: ThreadSummary = { status: 'loading' }

/** The model-written summary of a thread; `retry` asks again after a failure. */
export function useThreadSummary(thread: WorkThread): {
  summary: ThreadSummary
  retry: () => void
} {
  const [settled, setSettled] = useState<{ ticket: string; summary: ThreadSummary } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(thread)
  const ticket = `${signatureOf(thread)}#${attempt}`

  useEffect(() => {
    latest.current = thread
  })
  useEffect(() => {
    let current = true
    void fetchSummary(summaryInputOf(latest.current)).then(
      (summary) => current && setSettled({ ticket, summary })
    )
    return () => {
      current = false
    }
  }, [ticket])

  return {
    summary: settled?.ticket === ticket ? settled.summary : LOADING,
    retry: () => setAttempt((n) => n + 1),
  }
}
