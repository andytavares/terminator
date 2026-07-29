import type { HookDecision } from './control-server.js'

// A tool call the agent cannot make without a person, turned into console state
// a surface can act on, and the operator's answer turned back into something
// the runtime understands.
//
// The PreToolUse hook is the only thing that can hold a tool call still while
// somebody decides; the Notification hook does not fire for permission prompts
// at all (FR-010, research.md R1). What travels back is a hook decision rather
// than the SDK's PermissionResult, which is the only part of this file that
// ever cared how the agent was being run.

export interface PermissionDecision {
  allow: boolean
  reason?: string
  /**
   * A real answer, for a request that is a question rather than a yes/no.
   *
   * A hook decision has exactly two ways back to the agent: allow with an
   * updated input, or deny with a reason. The reason is the only channel that
   * carries words, so answering travels as a denial whose reason is the
   * answer — the tool call does not proceed, and the agent reads what you
   * said. Nothing is denied in the sense the operator would mean it.
   */
  answer?: string
}

/**
 * A tool call waiting on a person, in the shape a surface can render.
 *
 * Declared here rather than imported from the application: the extension owns
 * its own state, and a core event union that the console happened to share was
 * how the two ended up coupled in the first place.
 */
export interface PendingPermission {
  /** The conversation it belongs to, so an answer reaches the right run. */
  readonly sessionId: string
  readonly requestId: string
  readonly toolName: string
  /** One line naming what is actually being asked. */
  readonly summary: string
  /** The ask in full — a question's options, a command's every field. */
  readonly detail: string | null
  readonly questions?: ReadonlyArray<{ question: string; options: readonly string[] }>
  readonly targetHost?: string
  readonly at: number
}

export interface PermissionBridgeOptions {
  sessionId: string
  /** Raised when a tool call needs a person. */
  onPending: (pending: PendingPermission) => void
  /** Cleared when it has been answered, by the operator or the ladder. */
  onResolved: (requestId: string, decision: 'allow' | 'deny') => void
  now: () => number
  /** The autonomy ladder. Returns null to abstain and let the operator decide. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
  /**
   * How long to hold a tool call before handing the decision back to the
   * terminal.
   *
   * A request nobody answers must not block the agent indefinitely. When this
   * elapses the bridge abstains — `ask` — and Claude Code raises its own prompt
   * in the terminal the operator is already looking at, which they can answer
   * there. That is a worse surface than the console but an available one, and
   * it is the difference between a slow answer and a run that is stuck.
   */
  askAfterMs?: number
}

export interface PermissionBridge {
  canUseTool(toolName: string, input: unknown): Promise<HookDecision>
  resolve(requestId: string, decision: PermissionDecision): void
  /** Hands one back to the terminal, as the timeout does. */
  handBackToTerminal(requestId: string): void
  /** Denies everything outstanding. An unresolved promise would hang the turn. */
  rejectAll(reason: string): void
}

/** Best-effort host extraction, so the allowlist check has something to test (FR-042). */
function targetHostOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  const url = record.url
  if (typeof url === 'string') {
    try {
      return new URL(url).hostname
    } catch {
      return undefined
    }
  }
  const command = record.command
  if (typeof command === 'string') {
    const match = command.match(/-h\s+([A-Za-z0-9._-]+)/)
    return match?.[1]
  }
  return undefined
}

/** One readable line describing what the agent wants to do. FR-007 requires it. */
/**
 * What is actually being asked, in one line and then in full.
 *
 * Deciding requires seeing the ask. A summary of "AskUserQuestion request" is
 * the tool's name, not its question — you cannot approve or deny that, and
 * FR-007 exists precisely so a surface never puts you in that position.
 */
function summarise(toolName: string, input: unknown): { summary: string; detail: string | null } {
  if (typeof input !== 'object' || input === null)
    return { summary: `${toolName} request`, detail: null }
  const record = input as Record<string, unknown>

  // A question carries its text in a shape of its own, and its options are
  // most of what you need to answer it.
  const questions = record.questions
  if (Array.isArray(questions) && questions.length > 0) {
    const asked = questions
      .map((entry) => {
        const question = entry as Record<string, unknown>
        const text = typeof question.question === 'string' ? question.question : ''
        const options = Array.isArray(question.options)
          ? question.options
              .map((option) =>
                typeof option === 'object' && option !== null
                  ? String((option as Record<string, unknown>).label ?? '')
                  : String(option)
              )
              .filter((label) => label !== '')
          : []
        return options.length === 0 ? text : `${text}\n  ${options.join('\n  ')}`
      })
      .filter((text) => text.trim() !== '')

    if (asked.length > 0) {
      const first =
        typeof (questions[0] as Record<string, unknown>).question === 'string'
          ? ((questions[0] as Record<string, unknown>).question as string)
          : `${toolName} request`
      return { summary: first, detail: asked.join('\n\n') }
    }
  }

  // The headline: the field an operator would recognise the request by.
  const headline = ['command', 'url', 'file_path', 'path', 'pattern', 'prompt']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  // And then the whole input, verbatim. The headline is elided in a single-line
  // title, and a description is the agent's own account of what it is doing —
  // approving on either alone is taking its word for what the command does.
  return {
    summary: headline ?? `${toolName} request`,
    detail: renderInput(record),
  }
}

/**
 * The questions being asked and the answers each offers.
 *
 * Grouped rather than flattened: an ask with two questions produced one pile of
 * labels, and clicking "Throwaway" told the agent nothing about which question
 * it answered.
 */
function questionsOf(input: unknown): Array<{ question: string; options: string[] }> | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const questions = (input as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return undefined

  const asked = questions.flatMap((entry) => {
    const record = entry as Record<string, unknown>
    const question = typeof record.question === 'string' ? record.question : ''
    const options = Array.isArray(record.options)
      ? record.options
          .map((option) =>
            typeof option === 'object' && option !== null
              ? String((option as Record<string, unknown>).label ?? '')
              : String(option)
          )
          .filter((label) => label !== '')
      : []
    return question === '' && options.length === 0 ? [] : [{ question, options }]
  })

  return asked.length === 0 ? undefined : asked
}

/**
 * Every field the tool was given, verbatim.
 *
 * Bounded generously rather than tightly: a command must never be cut, because
 * the whole reason to show it is that the half you cannot see is the half that
 * might delete something. The surface scrolls.
 */
/**
 * Five minutes. Long enough to walk back to the console, short enough that a
 * run left alone keeps moving on the operator's own terminal rather than
 * sitting on a held hook for the twelve hours the hook itself allows.
 */
const DEFAULT_ASK_AFTER_MS = 5 * 60_000

const FIELD_LIMIT = 4_000
const FIELD_COUNT = 24

function renderInput(record: Record<string, unknown>): string | null {
  const lines = Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, FIELD_COUNT)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      const shown = text.length > FIELD_LIMIT ? `${text.slice(0, FIELD_LIMIT)}\n… truncated` : text
      // Multi-line values start on their own line so a diff or a script stays
      // readable rather than running off after the key.
      return shown.includes('\n') ? `${key}:\n${shown}` : `${key}: ${shown}`
    })
  return lines.length === 0 ? null : lines.join('\n')
}

export function createPermissionBridge(options: PermissionBridgeOptions): PermissionBridge {
  const { onPending, onResolved, now, autoDecide } = options
  const sessionId = options.sessionId
  const askAfterMs = options.askAfterMs ?? DEFAULT_ASK_AFTER_MS
  // The original input is held alongside the resolver: an `allow` must return
  // the input the agent asked with, not an empty one.
  const outstanding = new Map<
    string,
    { settle: (result: HookDecision) => void; input: unknown; timer: ReturnType<typeof setTimeout> }
  >()
  let counter = 0

  /**
   * Gives the decision back to Claude Code, which prompts in the terminal.
   *
   * Not an allow and not a deny: nothing is approved on the operator's behalf,
   * and nothing is refused because they were away from the console.
   */
  function handBack(requestId: string): void {
    const entry = outstanding.get(requestId)
    if (entry === undefined) return
    outstanding.delete(requestId)
    clearTimeout(entry.timer)
    onResolved(requestId, 'deny')
    entry.settle({ permissionDecision: 'ask' })
  }

  function toResult(decision: PermissionDecision, input: unknown): HookDecision {
    if (decision.answer !== undefined && decision.answer.trim() !== '') {
      return { permissionDecision: 'deny', reason: decision.answer.trim() }
    }
    return decision.allow
      ? { permissionDecision: 'allow', updatedInput: input }
      : {
          permissionDecision: 'deny',
          reason: decision.reason ?? 'Denied by the operator',
        }
  }

  return {
    canUseTool(toolName: string, input: unknown): Promise<HookDecision> {
      const auto = autoDecide?.(toolName, input) ?? null
      if (auto !== null) {
        // Resolved by the autonomy ladder — the operator is never interrupted,
        // and no prompt is raised for a surface to display.
        return Promise.resolve(toResult(auto, input))
      }

      const requestId = `${sessionId}-perm-${++counter}`
      onPending({
        sessionId,
        requestId,
        toolName,
        ...summarise(toolName, input),
        questions: questionsOf(input),
        targetHost: targetHostOf(input),
        at: now(),
      })

      return new Promise<HookDecision>((resolvePromise) => {
        const timer = setTimeout(() => handBack(requestId), askAfterMs)
        // Never keep the process alive for a prompt nobody is watching.
        timer.unref?.()
        outstanding.set(requestId, { settle: resolvePromise, input, timer })
      })
    },

    resolve(requestId: string, decision: PermissionDecision): void {
      const entry = outstanding.get(requestId)
      // Unknown or already-settled: a stale click must not publish a second
      // resolution or reopen a closed prompt.
      if (entry === undefined) return
      outstanding.delete(requestId)
      clearTimeout(entry.timer)
      onResolved(requestId, decision.allow ? 'allow' : 'deny')
      entry.settle(toResult(decision, entry.input))
    },

    handBackToTerminal(requestId: string): void {
      handBack(requestId)
    },

    rejectAll(reason: string): void {
      for (const [requestId, entry] of outstanding) {
        outstanding.delete(requestId)
        clearTimeout(entry.timer)
        entry.settle({ permissionDecision: 'deny', reason })
      }
    },
  }
}
