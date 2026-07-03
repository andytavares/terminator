// Parse a single line of the Claude Code CLI `--output-format stream-json`
// stream and return any assistant-visible text it contributes. Real-time text
// arrives as content_block_delta / text_delta events (enabled by
// --include-partial-messages); everything else — system/result/rate-limit
// metadata, tool-call deltas, and unparseable partial lines — yields ''.
//
// Schema verified against Claude Code CLI v2.1.199.

interface StreamJsonEvent {
  type?: string
  session_id?: string
  subtype?: string
  is_error?: boolean
  result?: string
  event?: {
    type?: string
    delta?: { type?: string; text?: string }
    content_block?: { type?: string; name?: string }
  }
}

// A short activity note for non-text events, so the console shows the agent
// working (tool calls) or failing (errors) between assistant messages instead of
// looking dead. Returns null for events that shouldn't be shown.
export function noteFromStreamJsonLine(jsonLine: string): string | null {
  const trimmed = jsonLine.trim()
  if (!trimmed) return null
  let evt: StreamJsonEvent
  try {
    evt = JSON.parse(trimmed) as StreamJsonEvent
  } catch {
    return null
  }
  // A tool call is starting — show which tool.
  if (
    evt.type === 'stream_event' &&
    evt.event?.type === 'content_block_start' &&
    evt.event.content_block?.type === 'tool_use' &&
    evt.event.content_block.name
  ) {
    return `🔧 ${evt.event.content_block.name}`
  }
  // The run ended in an error (e.g. rate limit, out of credits, max turns).
  if (evt.type === 'result' && (evt.is_error || (evt.subtype && evt.subtype !== 'success'))) {
    return `⚠ ${evt.result || evt.subtype || 'run ended with an error'}`
  }
  return null
}

// Extract the Claude Code session id from a stream-json line, if present. The
// `system`/`init` and final `result` events carry `session_id`; capturing it
// lets the pilot resume the conversation to answer the model's questions.
export function sessionIdFromStreamJsonLine(jsonLine: string): string | null {
  const trimmed = jsonLine.trim()
  if (!trimmed) return null
  try {
    const evt = JSON.parse(trimmed) as StreamJsonEvent
    return typeof evt.session_id === 'string' && evt.session_id ? evt.session_id : null
  } catch {
    return null
  }
}

export function textFromStreamJsonLine(jsonLine: string): string {
  const trimmed = jsonLine.trim()
  if (!trimmed) return ''
  let evt: StreamJsonEvent
  try {
    evt = JSON.parse(trimmed) as StreamJsonEvent
  } catch {
    return ''
  }
  if (
    evt.type === 'stream_event' &&
    evt.event?.type === 'content_block_delta' &&
    evt.event.delta?.type === 'text_delta'
  ) {
    return evt.event.delta.text ?? ''
  }
  return ''
}
