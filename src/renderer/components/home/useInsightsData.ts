import { useEffect, useState } from 'react'
import {
  ATTENTION_RETENTION_MS,
  type AttentionInterval,
  type AttentionMeasures,
} from '../../../shared/home/attention-measures'
import type { AgentUsage } from '../../../shared/agents/agent-usage'
import { rangeBefore, windowRange, type InsightsWindow } from '../../home/insights'

export interface InsightsData {
  attention: AttentionMeasures | null
  /** The same measures over the range just before, for "up from 4". */
  attentionBefore: AttentionMeasures | null
  usage: AgentUsage | null
  /** The log's intervals back to the retention limit: a ticket merged this week began earlier. */
  intervals: AttentionInterval[]
}

const NOTHING: InsightsData = { attention: null, attentionBefore: null, usage: null, intervals: [] }

type Range = { from: number; to: number }

function readAttention(range: Range): Promise<AttentionMeasures | null> {
  const api = window.electronAPI?.attention
  if (!api) return Promise.resolve(null)
  return api
    .measures({ window: range })
    .then((result) => result.data)
    .catch(() => null)
}

function readIntervals(range: Range): Promise<AttentionInterval[]> {
  const api = window.electronAPI?.attention
  if (!api?.intervals) return Promise.resolve([])
  return api
    .intervals({ window: { from: range.from - ATTENTION_RETENTION_MS, to: range.to } })
    .then((result) => result.data)
    .catch(() => [])
}

function readUsage(range: Range): Promise<AgentUsage | null> {
  const api = window.electronAPI?.agentUsage
  if (!api) return Promise.resolve(null)
  return api
    .get({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() })
    .then((result) => ('data' in result ? result.data : null))
    .catch(() => null)
}

/** What core measures itself over the chosen window: how agents waited, and what they used. */
export function useInsightsData(chosen: InsightsWindow): InsightsData {
  const [data, setData] = useState<InsightsData>(NOTHING)
  useEffect(() => {
    let current = true
    const range = windowRange(chosen, Date.now())
    void Promise.all([
      readAttention(range),
      readAttention(rangeBefore(range)),
      readUsage(range),
      readIntervals(range),
    ]).then(([attention, attentionBefore, usage, intervals]) => {
      if (current) setData({ attention, attentionBefore, usage, intervals })
    })
    return () => {
      current = false
    }
  }, [chosen])
  return data
}
