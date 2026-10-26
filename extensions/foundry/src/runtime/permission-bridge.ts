// A tool call the agent cannot make without a person, turned into console state
// a surface can act on, and the operator's answer turned back into a verdict.
//
// The agent asks over ACP (ADR 130) and the call stays asked until the verdict
// is sent, so a held call is simply an ask nobody has answered yet.

/**
 * What the bridge settles a tool call with. `ask` means nobody decided here: the
 * ask stays open in the agent's tab for whoever is watching it.
 */
export interface ToolVerdict {
  permissionDecision: 'allow' | 'deny' | 'ask'
  reason?: string
}

export interface PermissionDecision {
  allow: boolean
  reason?: string
  /**
   * A real answer, for a request that is a question rather than a yes/no.
   *
   * An ACP ask has two ways back to the agent: an allow option or a reject
   * option, with no words. An answer travels as a rejection, so the tool call
   * does not proceed; the words stay in the console's record. Nothing is
   * denied in the sense the operator would mean it.
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
   * The autonomy ladder. Null abstains and asks the operator; so does `mode`,
   * because inside an ask there is no auto mode left to defer to.
   */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
  /**
   * The ladder refused something, without asking anybody.
   *
   * Only refusals: an allow is one of hundreds and would drown the feed, while
   * a refusal is the reason the agent is about to do something else — or
   * nothing at all, which is what it did.
   */
  onAutoDenied?: (toolName: string, reason: string) => void
  /**
   * How long to hold a tool call before leaving it to the agent's tab.
   *
   * When this elapses the bridge drops the call from its held list and settles
   * it `ask`; the ask itself stays open in the agent's tab, where the operator
   * can answer it. That is a worse surface than the console but an available
   * one.
   */
  askAfterMs?: number
}

export interface PermissionBridge {
  /** `askId` names the ACP ask, so `withdraw` can find the call it raised. */
  canUseTool(toolName: string, input: unknown, askId?: string): Promise<ToolVerdict>
  /** True when it was still waiting; false when there was nothing to answer. */
  resolve(requestId: string, decision: PermissionDecision): boolean
  /** Leaves one to the agent's tab, as the timeout does. */
  handBackToTerminal(requestId: string): void
  /** The ask was answered elsewhere (in the agent's tab): drop its held call. */
  withdraw(askId: string, outcome: 'allowed' | 'rejected' | 'cancelled'): void
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
  readonly settle: (result: ToolVerdict) => void
  readonly askId: string | undefined
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
    canUseTool: (toolName, input, askId) => canUseTool(state, { toolName, input, askId }),
    resolve: (requestId, decision) => resolveRequest(state, requestId, decision),
    handBackToTerminal: (requestId) => handBack(state, requestId),
    withdraw: (askId, outcome) => withdrawAsk(state, { askId, outcome }),
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

// Leaves the decision to the agent's tab: nothing is approved for the operator, and
// nothing refused because they were away.
function handBack(state: BridgeState, requestId: string): void {
  const entry = takeOutstanding(state, requestId)
  if (entry === undefined) return
  // Handed back, not denied: the ask stays open in the tab. The feed said
  // "denied" for a request nobody had refused.
  state.options.onResolved(requestId, 'handback')
  entry.settle({ permissionDecision: 'ask' })
}

/** The operator's typed answer, trimmed; empty when they gave none. */
function answerOf(decision: PermissionDecision): string {
  return decision.answer?.trim() ?? ''
}

function toResult(decision: PermissionDecision): ToolVerdict {
  const answer = answerOf(decision)
  if (answer !== '') return { permissionDecision: 'deny', reason: answer }
  return decision.allow
    ? { permissionDecision: 'allow' }
    : {
        permissionDecision: 'deny',
        reason: decision.reason ?? 'Denied by the operator',
      }
}

function canUseTool(
  state: BridgeState,
  call: { toolName: string; input: unknown; askId: string | undefined }
): Promise<ToolVerdict> {
  const { toolName, input } = call
  const { options } = state
  const auto = options.autoDecide?.(toolName, input) ?? null
  if (auto !== null) {
    // Resolved by the autonomy ladder, with no prompt. A refusal is said out loud (an
    // allow would drown the feed): unseen, refusals made agents look like they went quiet.
    if (!auto.allow) options.onAutoDenied?.(toolName, auto.reason ?? 'no reason given')
    return Promise.resolve(toResult(auto))
  }
  return holdForAnswer(state, call)
}

/** Raises the call for a person and holds it until answered or handed back. */
function holdForAnswer(
  state: BridgeState,
  call: { toolName: string; input: unknown; askId: string | undefined }
): Promise<ToolVerdict> {
  const { toolName, input, askId } = call
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

  return new Promise<ToolVerdict>((resolvePromise) => {
    const timer = setTimeout(() => handBack(state, requestId), state.askAfterMs)
    // Never keep the process alive for a prompt nobody is watching.
    timer.unref?.()
    state.outstanding.set(requestId, { settle: resolvePromise, askId, timer })
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
  state.options.onResolved(requestId, permissionOutcomeOf(decision))
  entry.settle(toResult(decision))
  return true
}

function withdrawAsk(
  state: BridgeState,
  { askId, outcome }: { askId: string; outcome: 'allowed' | 'rejected' | 'cancelled' }
): void {
  for (const [requestId, entry] of state.outstanding) {
    if (entry.askId !== askId) continue
    takeOutstanding(state, requestId)
    // Settled where the agent is, or cancelled with its turn; nothing is left to send.
    state.options.onResolved(requestId, outcome === 'allowed' ? 'allow' : 'deny')
    entry.settle({ permissionDecision: 'ask' })
  }
}

function permissionOutcomeOf(decision: PermissionDecision): PermissionOutcome {
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
