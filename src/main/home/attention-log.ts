import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'
import { pruneIntervals, type AttentionInterval } from '../../shared/home/attention-measures.js'
import type { AgentState } from '../../shared/types/index.js'

// The renderer derives each session's state and reports every transition; this keeps the
// intervals between them, mirrored to disk atomically. `savedAt` ends what the last run left open.

const FILE_NAME = 'attention-log.json'

export interface StateReport {
  sessionId: string
  projectId: string | null
  branch: string | null
  workKey: string | null
  state: AgentState
  /** ISO time the state began. */
  at: string
}

let intervals: AttentionInterval[] = []

function attentionLogPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isInterval(value: unknown): value is AttentionInterval {
  const v = value as Partial<AttentionInterval> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.sessionId === 'string' &&
    (v.state === 'working' || v.state === 'awaiting-input') &&
    typeof v.start === 'string' &&
    (v.end === null || typeof v.end === 'string')
  )
}

/** Read what was stored, closing what the last run left open. Safe to call again. */
export async function loadAttentionLog(): Promise<void> {
  intervals = []
  try {
    const parsed = JSON.parse(await fs.readFile(attentionLogPath(), 'utf8')) as {
      savedAt?: unknown
      intervals?: unknown
    }
    const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : null
    const stored = Array.isArray(parsed.intervals) ? parsed.intervals.filter(isInterval) : []
    intervals = pruneIntervals(
      stored.map((interval) => closeAtShutdown(interval, savedAt)),
      Date.now()
    )
  } catch {
    // Missing or unreadable means no history, never a failed startup.
  }
}

function closeAtShutdown(interval: AttentionInterval, savedAt: string | null): AttentionInterval {
  if (interval.end !== null) return interval
  return { ...interval, end: savedAt ?? interval.start, next: 'exited' }
}

async function persist(): Promise<void> {
  intervals = pruneIntervals(intervals, Date.now())
  await writeJsonAtomic(attentionLogPath(), { savedAt: new Date().toISOString(), intervals })
}

function openIntervalOf(sessionId: string): AttentionInterval | undefined {
  return intervals.find((i) => i.sessionId === sessionId && i.end === null)
}

/** Ends the session's open interval at `report.at` in the state it went to, if it has one. */
function closeOpen(report: StateReport): void {
  const open = openIntervalOf(report.sessionId)
  if (open === undefined) return
  open.end = report.at
  open.next = report.state
}

/** Folds one transition in: the previous interval ends, and working or waiting begins a new one.
 * Repeating the state the session is already in changes nothing. */
export async function recordState(report: StateReport): Promise<void> {
  const open = openIntervalOf(report.sessionId)
  if (open?.state === report.state) return
  closeOpen(report)
  if (report.state === 'working' || report.state === 'awaiting-input') {
    intervals.push({
      sessionId: report.sessionId,
      projectId: report.projectId,
      branch: report.branch,
      workKey: report.workKey,
      state: report.state,
      start: report.at,
      end: null,
      next: null,
    })
  }
  await persist()
}

export function listIntervals(): AttentionInterval[] {
  return intervals
}
