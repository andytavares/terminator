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
/**
 * What became of a held tool call.
 *
 * Four outcomes, not two: handing one back to the terminal was published as a
 * `deny` and an answered question as an `allow` — both wrong in the feed and in
 * `foundry:permission-resolved`, where they read as decisions nobody made.
 */
export type PermissionOutcome = 'allow' | 'deny' | 'handback' | 'answered'

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
  onResolved: (requestId: string, decision: PermissionOutcome) => void
  now: () => number
  /**
   * The autonomy ladder. Null abstains and asks the operator; `mode` leaves
   * the call to Claude Code's own permission mode.
   */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | 'mode' | null
  /**
   * The ladder refused something, without asking anybody.
   *
   * Only refusals: an allow is one of hundreds and would drown the feed, while
   * a refusal is the reason the agent is about to do something else — or
   * nothing at all, which is what it did.
   */
  onAutoDenied?: (toolName: string, reason: string) => void
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
  /** True when it was still waiting; false when there was nothing to answer. */
  resolve(requestId: string, decision: PermissionDecision): boolean
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

/**
 * What is actually being asked, in one line and then in full.
 *
 * One readable line describing what the agent wants to do, because a decision
 * needs the ask rather than the tool's name.
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
  const asked = questionSummary(toolName, record.questions)
  if (asked !== null) return asked

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

/** A question's summary and its questions in full, or null when nothing is asked. */
function questionSummary(
  toolName: string,
  questions: unknown
): { summary: string; detail: string } | null {
  if (!Array.isArray(questions) || questions.length === 0) return null
  const asked = questions
    .map((entry) => {
      const question = entry as Record<string, unknown>
      const text = typeof question.question === 'string' ? question.question : ''
      const options = optionLabels(question.options)
      return options.length === 0 ? text : `${text}\n  ${options.join('\n  ')}`
    })
    .filter((text) => text.trim() !== '')
  if (asked.length === 0) return null

  const first = (questions[0] as Record<string, unknown>).question
  return {
    summary: typeof first === 'string' ? first : `${toolName} request`,
    detail: asked.join('\n\n'),
  }
}

/** What each of a question's options is called; none when it offers none. */
function optionLabels(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .map((option) =>
      typeof option === 'object' && option !== null
        ? String((option as Record<string, unknown>).label ?? '')
        : String(option)
    )
    .filter((label) => label !== '')
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
    const options = optionLabels(record.options)
    return question === '' && options.length === 0 ? [] : [{ question, options }]
  })

  return asked.length === 0 ? undefined : asked
}

/**
 * Five minutes. Long enough to walk back to the console, short enough that a
 * run left alone keeps moving on the operator's own terminal rather than
 * sitting on a held hook for the twelve hours the hook itself allows.
 */
const DEFAULT_ASK_AFTER_MS = 5 * 60_000

const FIELD_LIMIT = 4_000
const FIELD_COUNT = 24

/**
 * Every field the tool was given, verbatim.
 *
 * Bounded generously rather than tightly: a command must never be cut, because
 * the whole reason to show it is that the half you cannot see is the half that
 * might delete something. The surface scrolls.
 */
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

/** A held tool call: how to answer it, what it asked with, and its hand-back timer. */
interface Outstanding {
  readonly settle: (result: HookDecision) => void
  /** An `allow` must return the input the agent asked with, not an empty one. */
  readonly input: unknown
  readonly timer: ReturnType<typeof setTimeout>
}

/** One bridge's options, and the tool calls it is holding. */
interface BridgeState {
  readonly options: PermissionBridgeOptions
  readonly askAfterMs: number
  readonly outstanding: Map<string, Outstanding>
  /** How many calls this session has held, which numbers each request. */
  held: number
}

export function createPermissionBridge(options: PermissionBridgeOptions): PermissionBridge {
  const state: BridgeState = {
    options,
    askAfterMs: options.askAfterMs ?? DEFAULT_ASK_AFTER_MS,
    outstanding: new Map(),
    held: 0,
  }
  return {
    canUseTool: (toolName, input) => canUseTool(state, toolName, input),
    resolve: (requestId, decision) => resolveRequest(state, requestId, decision),
    handBackToTerminal: (requestId) => handBack(state, requestId),
    rejectAll: (reason) => rejectAll(state, reason),
  }
}

/** Takes a held call off the books; undefined when it was no longer held. */
function takeOutstanding(state: BridgeState, requestId: string): Outstanding | undefined {
  const entry = state.outstanding.get(requestId)
  if (entry === undefined) return undefined
  state.outstanding.delete(requestId)
  clearTimeout(entry.timer)
  return entry
}

/**
 * Gives the decision back to Claude Code, which prompts in the terminal.
 *
 * Not an allow and not a deny: nothing is approved on the operator's behalf,
 * and nothing is refused because they were away from the console.
 */
function handBack(state: BridgeState, requestId: string): void {
  const entry = takeOutstanding(state, requestId)
  if (entry === undefined) return
  // Handed back, not denied: the runtime asks in the terminal instead. The
  // feed said "denied" for a request nobody had refused.
  state.options.onResolved(requestId, 'handback')
  entry.settle({ permissionDecision: 'ask' })
}

/** The operator's typed answer, trimmed; empty when they gave none. */
function answerOf(decision: PermissionDecision): string {
  return decision.answer?.trim() ?? ''
}

function toResult(decision: PermissionDecision, input: unknown): HookDecision {
  const answer = answerOf(decision)
  if (answer !== '') return { permissionDecision: 'deny', reason: answer }
  return decision.allow
    ? { permissionDecision: 'allow', updatedInput: input }
    : {
        permissionDecision: 'deny',
        reason: decision.reason ?? 'Denied by the operator',
      }
}

function canUseTool(state: BridgeState, toolName: string, input: unknown): Promise<HookDecision> {
  const { options } = state
  const auto = options.autoDecide?.(toolName, input) ?? null
  if (auto === 'mode') return Promise.resolve({ permissionDecision: 'defer' })
  if (auto !== null) {
    // Resolved by the autonomy ladder — the operator is never interrupted,
    // and no prompt is raised for a surface to display.
    //
    // A *refusal* is said out loud, though. An allow is one of hundreds and
    // would drown the feed; a denial is the reason an agent is about to do
    // something else, or nothing, and it was invisible: four live runs died
    // on refused commands and the console showed an agent that had simply
    // gone quiet. Reading its transcript was the only way to find out.
    if (!auto.allow) options.onAutoDenied?.(toolName, auto.reason ?? 'no reason given')
    return Promise.resolve(toResult(auto, input))
  }
  return hold(state, toolName, input)
}

/** Raises the call for a person and holds it until answered or handed back. */
function hold(state: BridgeState, toolName: string, input: unknown): Promise<HookDecision> {
  const { options } = state
  const { sessionId } = options
  const requestId = `${sessionId}-perm-${++state.held}`
  options.onPending({
    sessionId,
    requestId,
    toolName,
    ...summarise(toolName, input),
    questions: questionsOf(input),
    targetHost: targetHostOf(input),
    at: options.now(),
  })

  return new Promise<HookDecision>((resolvePromise) => {
    const timer = setTimeout(() => handBack(state, requestId), state.askAfterMs)
    // Never keep the process alive for a prompt nobody is watching.
    timer.unref?.()
    state.outstanding.set(requestId, { settle: resolvePromise, input, timer })
  })
}

function resolveRequest(
  state: BridgeState,
  requestId: string,
  decision: PermissionDecision
): boolean {
  const entry = takeOutstanding(state, requestId)
  // Unknown or already-settled: a stale click must not publish a second
  // resolution or reopen a closed prompt. Reported, so the surface can say
  // the request is gone instead of showing a success that did nothing.
  if (entry === undefined) return false
  // An answer is its own outcome. `toResult` encodes one as a deny
  // carrying the words, so reporting it as `allow` — or as `deny` — both
  // misread what the operator did.
  state.options.onResolved(requestId, outcomeOf(decision))
  entry.settle(toResult(decision, entry.input))
  return true
}

function outcomeOf(decision: PermissionDecision): PermissionOutcome {
  if (answerOf(decision) !== '') return 'answered'
  return decision.allow ? 'allow' : 'deny'
}

function rejectAll(state: BridgeState, reason: string): void {
  for (const [requestId, entry] of state.outstanding) {
    state.outstanding.delete(requestId)
    clearTimeout(entry.timer)
    entry.settle({ permissionDecision: 'deny', reason })
    // Told, not just settled. Without this the board went on listing tool
    // calls from a run that had ended, and clicking them did nothing.
    state.options.onResolved(requestId, 'deny')
  }
}
