import type { AgentUpdate } from '@terminator/extension-sdk'
import { linesFromTexts } from '@terminator/extension-ui'

type MessageRole = 'agent' | 'thought' | 'user'

type ToolOutput =
  | { kind: 'diff'; path: string; oldText: string | null; newText: string }
  | { kind: 'text'; text: string }

export type ToolEntry = {
  kind: 'tool'
  toolCallId: string
  title: string
  toolKind: string | null
  status: string | null
  /** The command or path the tool works on. */
  detail: string | null
  output: ToolOutput[]
}

export type TranscriptEntry = { kind: 'message'; role: MessageRole; text: string } | ToolEntry

interface PlanItem {
  content: string
  status: string
  priority: string
}

export interface Usage {
  used: number
  size: number
  cost?: { amount: number; currency: string }
}

export interface Transcript {
  entries: TranscriptEntry[]
  plan: PlanItem[] | null
  usage: Usage | null
}

export const emptyTranscript: Transcript = { entries: [], plan: null, usage: null }

const ROLE_OF: Record<string, MessageRole> = {
  agent_message_chunk: 'agent',
  agent_thought_chunk: 'thought',
  user_message_chunk: 'user',
}

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The command or path a tool input names, for a one-line label. */
export function inputSummary(rawInput: unknown): string | null {
  if (!isRecord(rawInput)) return null
  return asString(rawInput.command) ?? asString(rawInput.file_path) ?? asString(rawInput.path)
}

function diffOutput(item: Json): ToolOutput {
  return {
    kind: 'diff',
    path: asString(item.path) ?? '',
    oldText: asString(item.oldText),
    newText: asString(item.newText) ?? '',
  }
}

function outputItem(item: unknown): ToolOutput[] {
  if (!isRecord(item)) return []
  if (item.type === 'diff') return [diffOutput(item)]
  const text = isRecord(item.content) ? asString(item.content.text) : null
  return text === null ? [] : [{ kind: 'text', text }]
}

const outputOf = (content: unknown): ToolOutput[] =>
  Array.isArray(content) ? content.flatMap(outputItem) : []

function locationOf(update: Json): string | null {
  const first = Array.isArray(update.locations) ? update.locations[0] : undefined
  return isRecord(first) ? asString(first.path) : null
}

function withChunk(entries: TranscriptEntry[], role: MessageRole, text: string) {
  const last = entries[entries.length - 1]
  if (last?.kind === 'message' && last.role === role) {
    return [...entries.slice(0, -1), { ...last, text: last.text + text }]
  }
  return [...entries, { kind: 'message' as const, role, text }]
}

function newTool(update: Json): ToolEntry {
  return {
    kind: 'tool',
    toolCallId: asString(update.toolCallId) ?? '',
    title: asString(update.title) ?? '',
    toolKind: asString(update.kind),
    status: asString(update.status),
    detail: inputSummary(update.rawInput) ?? locationOf(update),
    output: outputOf(update.content),
  }
}

const keep = <T>(next: T | null, previous: T): T => next ?? previous

/** Changed fields only: a field the update leaves out keeps its value. */
function updatedTool(tool: ToolEntry, update: Json): ToolEntry {
  return {
    ...tool,
    title: keep(asString(update.title), tool.title),
    toolKind: keep(asString(update.kind), tool.toolKind),
    status: keep(asString(update.status), tool.status),
    detail: keep(inputSummary(update.rawInput) ?? locationOf(update), tool.detail),
    output: Array.isArray(update.content) ? outputOf(update.content) : tool.output,
  }
}

function withToolUpdate(entries: TranscriptEntry[], update: Json): TranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'tool' && entry.toolCallId === update.toolCallId
      ? updatedTool(entry, update)
      : entry
  )
}

function foldChunk(transcript: Transcript, role: MessageRole, update: Json): Transcript {
  const text = isRecord(update.content) ? asString(update.content.text) : null
  if (text === null) return transcript
  return { ...transcript, entries: withChunk(transcript.entries, role, text) }
}

/** Adds one agent update to the transcript; an update that draws nothing returns it unchanged. */
export function foldUpdates(transcript: Transcript, update: AgentUpdate): Transcript {
  const role = ROLE_OF[update.sessionUpdate]
  if (role) return foldChunk(transcript, role, update)
  switch (update.sessionUpdate) {
    case 'tool_call':
      return { ...transcript, entries: [...transcript.entries, newTool(update)] }
    case 'tool_call_update':
      return { ...transcript, entries: withToolUpdate(transcript.entries, update) }
    case 'plan':
      return { ...transcript, plan: update.entries as PlanItem[] }
    case 'usage_update':
      return {
        ...transcript,
        usage: {
          used: update.used as number,
          size: update.size as number,
          cost: update.cost as Usage['cost'],
        },
      }
    default:
      return transcript
  }
}

/** A path relative to the session directory; a path outside it stays as it is. */
export function relativeTo(cwd: string, path: string): string {
  // An agent reports real paths: on macOS /var and /tmp resolve to /private/var and /private/tmp.
  const real = (p: string): string => p.replace(/^\/private(?=\/)/, '')
  const [folder, file] = [real(cwd), real(path)]
  return folder && file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : path
}

interface ChangedFile {
  path: string
  added: number
  removed: number
}

export interface Turn {
  entries: TranscriptEntry[]
  /** One row per file, however many edits touched it. */
  changes: ChangedFile[]
}

type DiffOutput = Extract<ToolOutput, { kind: 'diff' }>

const diffLines = new WeakMap<DiffOutput, ReturnType<typeof linesFromTexts>>()

/** A diff's lines, worked out once per diff: the transcript re-renders as text streams in. */
export function diffLinesOf(out: DiffOutput): ReturnType<typeof linesFromTexts> {
  const known = diffLines.get(out)
  if (known) return known
  const lines = linesFromTexts(out.oldText, out.newText)
  diffLines.set(out, lines)
  return lines
}

function changesOf(entries: TranscriptEntry[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()
  for (const entry of entries) {
    if (entry.kind !== 'tool') continue
    for (const out of entry.output) {
      if (out.kind !== 'diff') continue
      const file = byPath.get(out.path) ?? { path: out.path, added: 0, removed: 0 }
      for (const line of diffLinesOf(out)) {
        if (line.type === 'add') file.added++
        if (line.type === 'remove') file.removed++
      }
      byPath.set(out.path, file)
    }
  }
  return [...byPath.values()]
}

/** The entries cut into turns: a turn starts at each message the person sent. */
export function splitTurns(entries: TranscriptEntry[]): Turn[] {
  const groups: TranscriptEntry[][] = []
  for (const entry of entries) {
    const startsTurn = entry.kind === 'message' && entry.role === 'user'
    if (startsTurn || groups.length === 0) groups.push([entry])
    else groups[groups.length - 1].push(entry)
  }
  return groups.map((group) => ({ entries: group, changes: changesOf(group) }))
}
