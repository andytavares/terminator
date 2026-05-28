import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { HistoryEntry } from '../types/foundry.types.js'

const HISTORY_PATH = (workspaceRoot: string) =>
  path.join(workspaceRoot, '.foundry', 'history.jsonl')

export async function appendHistoryEntry(
  workspaceRoot: string,
  entry: HistoryEntry
): Promise<void> {
  const foundryDir = path.join(workspaceRoot, '.foundry')
  await fs.mkdir(foundryDir, { recursive: true })
  await fs.appendFile(HISTORY_PATH(workspaceRoot), JSON.stringify(entry) + '\n', 'utf-8')
}

export async function readHistory(
  workspaceRoot: string,
  offset: number,
  limit: number
): Promise<{ entries: HistoryEntry[]; total: number; hasMore: boolean }> {
  let raw: string
  try {
    raw = await fs.readFile(HISTORY_PATH(workspaceRoot), 'utf-8')
  } catch {
    return { entries: [], total: 0, hasMore: false }
  }

  const all: HistoryEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      all.push(JSON.parse(trimmed) as HistoryEntry)
    } catch {
      // skip malformed lines
    }
  }

  // newest first
  all.reverse()

  const total = all.length
  const page = all.slice(offset, offset + limit)
  return { entries: page, total, hasMore: offset + limit < total }
}

export async function deleteHistoryEntry(
  workspaceRoot: string,
  runId: string
): Promise<{ ok: true } | { error: string }> {
  const filePath = HISTORY_PATH(workspaceRoot)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch {
    return { ok: true } // file doesn't exist — nothing to delete
  }
  const filtered = raw
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      try {
        const entry = JSON.parse(trimmed) as { runId?: string }
        return entry.runId !== runId
      } catch {
        return true // keep malformed lines
      }
    })
    .join('\n')
  try {
    await fs.writeFile(filePath, filtered ? filtered + '\n' : '', 'utf-8')
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
