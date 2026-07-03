// Parse a single line of the Claude Code CLI `--output-format stream-json`
// stream and return any assistant-visible text it contributes. Real-time text
// arrives as content_block_delta / text_delta events (enabled by
// --include-partial-messages); everything else — system/result/rate-limit
// metadata, tool-call deltas, and unparseable partial lines — yields ''.
//
// Schema verified against Claude Code CLI v2.1.199.

interface StreamJsonEvent {
  type?: string
  event?: {
    type?: string
    delta?: { type?: string; text?: string }
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
