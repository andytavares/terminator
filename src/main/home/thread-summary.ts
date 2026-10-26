import { createHash } from 'node:crypto'
import type { RunAgentOnceInput, RunAgentOnceResult } from '@terminator/extension-sdk'
import { tmpdir } from 'node:os'
import type { ThreadSummaryInput } from '../../shared/schemas/agent-usage.schema.js'

// Runs the agent through ACP with no tools and no tab. The login-shell PATH is adopted at
// start-up (login-shell-path.ts), so the agent is found once `ready` has resolved.

const SUMMARY_MODEL = 'claude-haiku-5-5'
/** @internal */
export const SUMMARY_TIMEOUT_MS = 30_000
/** @internal */
export const SUMMARY_COOLDOWN_MS = 2 * 60_000

/** @internal */
export const SUMMARY_INSTRUCTION =
  'Write two or three plain sentences saying what is happening on this piece of work right now ' +
  'and what is blocking it. No lists, no headings.'

export type ThreadSummary = { text: string; generatedAt: string } | { error: string }

export interface ThreadSummaryDeps {
  runOnce: (input: RunAgentOnceInput) => Promise<RunAgentOnceResult>
  now: () => number
  /** Resolves once the agent can be found on PATH. */
  ready: () => Promise<void>
}

/** @internal */
export function summaryPrompt(input: ThreadSummaryInput): string {
  const lines = [`Work: ${input.title}${input.ticketKey ? ` (${input.ticketKey})` : ''}`]
  if (input.pullRequest) {
    const { number, isDraft, checksLine } = input.pullRequest
    lines.push(`Pull request #${number}${isDraft ? ' (draft)' : ''}: ${checksLine}`)
  }
  input.sessions.forEach((session, index) => {
    lines.push(`\nSession ${index + 1}, ${session.state}.`)
    if (session.firstUserPrompt) lines.push(`Asked: ${session.firstUserPrompt}`)
    for (const text of session.lastAssistantTexts) lines.push(`Said: ${text}`)
  })
  return `${SUMMARY_INSTRUCTION}\n\n${lines.join('\n')}`
}

function plainFailure(result: RunAgentOnceResult): string {
  if ('error' in result) {
    if (result.error === 'TIMEOUT') return 'the agent took too long to answer'
    if (result.error === 'AGENT_UNAVAILABLE') return 'the agent is not installed or did not start'
  }
  return 'the agent stopped with an error'
}

function hashOf(input: ThreadSummaryInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

async function generate(
  deps: ThreadSummaryDeps,
  input: ThreadSummaryInput
): Promise<ThreadSummary> {
  await deps.ready()
  const result = await deps.runOnce({
    cwd: tmpdir(),
    prompt: summaryPrompt(input),
    mode: 'default',
    agentMeta: {
      claudeCode: {
        options: { model: SUMMARY_MODEL, tools: [], systemPrompt: SUMMARY_INSTRUCTION },
      },
    },
    timeoutMs: SUMMARY_TIMEOUT_MS,
  })
  const text = 'text' in result ? result.text.trim() : ''
  if (!text) return { error: `Could not write a summary: ${plainFailure(result)}` }
  return { text, generatedAt: new Date(deps.now()).toISOString() }
}

/** One summary per distinct input, one run at a time per input, one new summary per thread per cooldown. */
export function createThreadSummarizer(deps: ThreadSummaryDeps) {
  const byInput = new Map<string, ThreadSummary>()
  const running = new Map<string, Promise<ThreadSummary>>()
  const latestByThread = new Map<string, { at: number; summary: ThreadSummary }>()

  async function run(key: string, thread: string, input: ThreadSummaryInput) {
    const started = generate(deps, input)
    running.set(key, started)
    try {
      const summary = await started
      if ('text' in summary) {
        byInput.set(key, summary)
        latestByThread.set(thread, { at: deps.now(), summary })
      }
      return summary
    } finally {
      running.delete(key)
    }
  }

  return async function summarize(input: ThreadSummaryInput): Promise<ThreadSummary> {
    const key = hashOf(input)
    const thread = input.ticketKey ?? input.title
    const latest = latestByThread.get(thread)
    const withinCooldown = latest && deps.now() - latest.at < SUMMARY_COOLDOWN_MS
    return (
      byInput.get(key) ??
      running.get(key) ??
      (withinCooldown ? latest.summary : run(key, thread, input))
    )
  }
}
