import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { Signal } from './types'

// Everything a sensor produces or remembers lives under
// `<dataRoot>/signals/`, never inside a repository (ADR-066): the data root is
// resolved once by the caller (see `data-root.ts`) and handed in here.
//
// `signals.jsonl` is append-only. A signal's status changes over its life —
// open, promoted, dismissed — and each change is a new line rather than a
// rewrite, so the history of a signal is the log itself. `list()` collapses
// that to the latest line per id.
//
// `state.json` is the opposite shape: one small record of what each sensor is
// doing right now, rewritten whole through a temp file and a rename so a
// crash mid-write leaves the old state rather than a torn one.

export interface SensorState {
  readonly enabled: boolean
  readonly lastRunAt: string | null
  readonly lastProblem: string | null
}

export interface SignalStore {
  list(): Promise<Signal[]>
  save(signals: readonly Signal[]): Promise<void>
  get(id: string): Promise<Signal | null>
  /**
   * Read from `state.json` as stored — a sensor id absent from the file is
   * simply absent from this record. Callers that need a default for an
   * unknown sensor apply it themselves.
   */
  sensorState(): Promise<Record<string, SensorState>>
  setSensorState(id: string, patch: Partial<SensorState>): Promise<Record<string, SensorState>>
}

function signalsDir(dataRoot: string): string {
  return path.join(dataRoot, 'signals')
}

function signalsPath(dataRoot: string): string {
  return path.join(signalsDir(dataRoot), 'signals.jsonl')
}

function statePath(dataRoot: string): string {
  return path.join(signalsDir(dataRoot), 'state.json')
}

async function readSignalLines(file: string): Promise<Signal[]> {
  let raw: string
  try {
    raw = await fs.promises.readFile(file, 'utf-8')
  } catch {
    return []
  }
  const records: Signal[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      records.push(JSON.parse(trimmed) as Signal)
    } catch {
      // A torn or partially written last line. Skip it rather than throw —
      // losing one record is correct, losing the whole log is not.
    }
  }
  return records
}

/** The latest line per signal id, in first-seen order. */
function latestById(lines: readonly Signal[]): Map<string, Signal> {
  const byId = new Map<string, Signal>()
  for (const line of lines) byId.set(line.id, line)
  return byId
}

async function readState(file: string): Promise<Record<string, SensorState>> {
  let raw: string
  try {
    raw = await fs.promises.readFile(file, 'utf-8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, SensorState>)
      : {}
  } catch {
    return {}
  }
}

async function writeState(file: string, state: Record<string, SensorState>): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(os.tmpdir(), `foundry-sensor-state-${process.pid}-${Date.now()}.tmp`)
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2))
  await fs.promises.rename(tmp, file)
}

export function createSignalStore(dataRoot: string): SignalStore {
  const jsonlFile = signalsPath(dataRoot)
  const stateFile = statePath(dataRoot)

  return {
    async list(): Promise<Signal[]> {
      const lines = await readSignalLines(jsonlFile)
      return Array.from(latestById(lines).values())
    },

    async save(signals: readonly Signal[]): Promise<void> {
      if (signals.length === 0) return
      const lines = await readSignalLines(jsonlFile)
      const latest = latestById(lines)
      const toAppend = signals.filter((signal) => {
        const current = latest.get(signal.id)
        return current === undefined || JSON.stringify(current) !== JSON.stringify(signal)
      })
      if (toAppend.length === 0) return

      await fs.promises.mkdir(signalsDir(dataRoot), { recursive: true })
      const text = toAppend.map((signal) => JSON.stringify(signal) + '\n').join('')
      await fs.promises.appendFile(jsonlFile, text, 'utf-8')
    },

    async get(id: string): Promise<Signal | null> {
      const lines = await readSignalLines(jsonlFile)
      return latestById(lines).get(id) ?? null
    },

    async sensorState(): Promise<Record<string, SensorState>> {
      return readState(stateFile)
    },

    async setSensorState(
      id: string,
      patch: Partial<SensorState>
    ): Promise<Record<string, SensorState>> {
      const current = await readState(stateFile)
      const next: Record<string, SensorState> = {
        ...current,
        [id]: { ...current[id], ...patch } as SensorState,
      }
      await writeState(stateFile, next)
      return next
    },
  }
}
