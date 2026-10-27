import type { AgentUpdate, AgentsAPI } from '@terminator/extension-sdk'
import { namedFile, SHELL_TOOLS, type ToolActivity } from './transcript-tailer.js'

// What an agent's tools are doing, learned from the ACP updates the core already
// sends (`tool_call`, then `tool_call_update` with a status) rather than from Claude
// Code's transcript file, whose format Claude does not publish.

export interface ToolActivityTracker {
  /** Every tool start and finish seen so far, oldest first. */
  activity(): readonly ToolActivity[]
  stop(): void
}

const FINISHED = new Set(['completed', 'failed'])

/** The tool's name from the agent's `_meta`, or null when it sent none. */
function toolNameOf(update: AgentUpdate): string | null {
  const meta = update._meta as { claudeCode?: { toolName?: unknown } } | undefined
  const name = meta?.claudeCode?.toolName
  return typeof name === 'string' ? name : null
}

function startedFrom(update: AgentUpdate, callId: string, at: number): ToolActivity {
  const toolName = toolNameOf(update) ?? 'unknown'
  const named = namedFile(update.rawInput)
  return {
    kind: 'tool_started',
    toolName,
    callId,
    isShell: SHELL_TOOLS.has(toolName),
    path: typeof named === 'string' ? named : null,
    at,
  }
}

function finishedFrom(update: AgentUpdate, started: ToolActivity | undefined, at: number) {
  const toolName = started?.toolName ?? toolNameOf(update) ?? ''
  return {
    kind: 'tool_finished',
    toolName,
    callId: String(update.toolCallId),
    isShell: started?.isShell ?? SHELL_TOOLS.has(toolName),
    path: null,
    at,
  } satisfies ToolActivity
}

/** Listens to one session's updates and keeps its tool calls, in memory, for as long as it lives. */
export function trackToolActivity(
  agents: Pick<AgentsAPI, 'onUpdate'>,
  sessionId: string,
  now: () => number = Date.now
): ToolActivityTracker {
  const activity: ToolActivity[] = []
  const started = new Map<string, ToolActivity>()
  const stop = agents.onUpdate(sessionId, (update) => {
    if (typeof update.toolCallId !== 'string') return
    const { toolCallId } = update
    if (update.sessionUpdate === 'tool_call') {
      const event = startedFrom(update, toolCallId, now())
      started.set(toolCallId, event)
      activity.push(event)
    } else if (update.sessionUpdate === 'tool_call_update' && FINISHED.has(String(update.status))) {
      activity.push(finishedFrom(update, started.get(toolCallId), now()))
    }
  })
  return { activity: () => activity, stop }
}
