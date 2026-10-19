import * as fs from 'node:fs'
import { addTokens, emptyTokens, type TokenCounts } from '../../shared/agents/model-prices.js'

// Reads a Claude Code transcript (one JSON object per line) for what a session cost and said.
// Claude Code writes one line per content block of an assistant message, each carrying the
// message's full usage, so usage is counted once per `message.id` while text is taken from every line.

const PROMPT_MAX_CHARS = 200
const TEXT_MAX_CHARS = 600
const KEPT_TEXTS = 5

export interface TranscriptUsage {
  byModel: Record<string, TokenCounts>
  firstUserPrompt: string | null
  lastAssistantTexts: string[]
  firstTimestamp: string | null
  lastTimestamp: string | null
}

interface ParseState extends TranscriptUsage {
  seenMessageIds: Set<string>
}

interface CacheEntry {
  mtimeMs: number
  size: number
  /** Bytes of whole lines already read; a line still being written is left for the next read. */
  offset: number
  state: ParseState
  result: TranscriptUsage
}

const cache = new Map<string, CacheEntry>()

export function forgetTranscriptCache(): void {
  cache.clear()
}

interface TranscriptLine {
  type?: string
  timestamp?: string
  message?: {
    id?: string
    model?: string
    content?: string | { type?: string; text?: string }[]
    usage?: Record<string, number | undefined>
  }
}

function emptyState(): ParseState {
  return {
    byModel: {},
    firstUserPrompt: null,
    lastAssistantTexts: [],
    firstTimestamp: null,
    lastTimestamp: null,
    seenMessageIds: new Set(),
  }
}

function messageText(content: NonNullable<TranscriptLine['message']>['content']): string {
  if (typeof content === 'string') return content.trim()
  return (content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!.trim())
    .join('\n')
    .trim()
}

function tokensOf(usage: Record<string, number | undefined>): TokenCounts {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  }
}

/** True when this message id has not been counted before, and records it. */
function firstSighting(state: ParseState, id: string | undefined): boolean {
  if (!id) return true
  if (state.seenMessageIds.has(id)) return false
  state.seenMessageIds.add(id)
  return true
}

function countUsage(state: ParseState, message: NonNullable<TranscriptLine['message']>): void {
  const { id, model, usage } = message
  if (!usage || !model || model === '<synthetic>' || !firstSighting(state, id)) return
  addTokens((state.byModel[model] ??= emptyTokens()), tokensOf(usage))
}

function noteTimestamp(state: ParseState, timestamp: string | undefined): void {
  if (!timestamp) return
  state.firstTimestamp ??= timestamp
  state.lastTimestamp = timestamp
}

function noteUserPrompt(state: ParseState, text: string): void {
  if (text && state.firstUserPrompt === null)
    state.firstUserPrompt = text.slice(0, PROMPT_MAX_CHARS)
}

function noteAssistantText(state: ParseState, text: string): void {
  if (!text) return
  const kept = [...state.lastAssistantTexts, text.slice(0, TEXT_MAX_CHARS)]
  state.lastAssistantTexts = kept.slice(-KEPT_TEXTS)
}

function applyLine(state: ParseState, line: TranscriptLine): void {
  const { message } = line
  if (!message || (line.type !== 'assistant' && line.type !== 'user')) return
  noteTimestamp(state, line.timestamp)
  const text = messageText(message.content)
  if (line.type === 'user') return noteUserPrompt(state, text)
  countUsage(state, message)
  noteAssistantText(state, text)
}

function applyText(state: ParseState, text: string): void {
  for (const raw of text.split('\n')) {
    try {
      applyLine(state, JSON.parse(raw) as TranscriptLine)
    } catch {
      // A line that is not JSON carries nothing to count.
    }
  }
}

/** Reads bytes [start, end) of the file as text. */
async function readByteRange(file: string, start: number, end: number): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of fs.createReadStream(file, { start, end: end - 1 })) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function snapshot(state: ParseState): TranscriptUsage {
  const { seenMessageIds: _seen, ...result } = state
  return { ...result, byModel: structuredClone(result.byModel) }
}

async function readFromCache(file: string): Promise<TranscriptUsage> {
  const { mtimeMs, size } = await fs.promises.stat(file)
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.result

  const grew = cached !== undefined && size > cached.size
  const state = grew ? cached.state : emptyState()
  const start = grew ? cached.offset : 0
  const tail = await readByteRange(file, start, size)
  const lastNewline = tail.lastIndexOf('\n')
  const whole = lastNewline === -1 ? '' : tail.slice(0, lastNewline)
  applyText(state, whole)
  const offset = start + Buffer.byteLength(whole, 'utf8') + (lastNewline === -1 ? 0 : 1)

  const result = snapshot(state)
  cache.set(file, { mtimeMs, size, offset, state, result })
  return result
}

/** The last read queued for each file: a read starts only once the one before it has stored its state. */
const queued = new Map<string, Promise<unknown>>()

/** Token usage by model plus the opening prompt and latest assistant words of a transcript. */
export function readTranscriptUsage(file: string): Promise<TranscriptUsage> {
  const read = (queued.get(file) ?? Promise.resolve()).then(() => readFromCache(file))
  const settled = read.catch(() => undefined)
  queued.set(file, settled)
  void settled.then(() => {
    if (queued.get(file) === settled) queued.delete(file)
  })
  return read
}
