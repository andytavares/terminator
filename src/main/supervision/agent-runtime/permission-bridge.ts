import type { SessionEvent } from '../events/session-event.js'

// canUseTool is the only documented way to observe that an agent is blocked on
// the operator: the Notification hook does not fire for permission prompts
// (FR-010, research.md R1). This bridge turns that callback into console state
// a surface can act on, and turns the operator's decision back into the
// PermissionResult shape the runtime expects.

/** The runtime's documented PermissionResult, restated so the seam owns the shape. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string; interrupt: boolean }

export interface PermissionDecision {
  allow: boolean
  reason?: string
  interrupt?: boolean
}

export interface PermissionBridgeOptions {
  sessionId: string
  publish: (event: SessionEvent) => void
  now: () => number
  /** The autonomy ladder. Returns null to abstain and let the operator decide. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
}

export interface PermissionBridge {
  canUseTool(toolName: string, input: unknown): Promise<PermissionResult>
  resolve(requestId: string, decision: PermissionDecision): void
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
function summarise(toolName: string, input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>
    for (const key of ['command', 'url', 'file_path', 'path', 'pattern']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return `${toolName} request`
}

export function createPermissionBridge(options: PermissionBridgeOptions): PermissionBridge {
  const { sessionId, publish, now, autoDecide } = options
  // The original input is held alongside the resolver: an `allow` must return
  // the input the agent asked with, not an empty one.
  const outstanding = new Map<
    string,
    { settle: (result: PermissionResult) => void; input: unknown }
  >()
  let counter = 0

  function toResult(decision: PermissionDecision, input: unknown): PermissionResult {
    return decision.allow
      ? { behavior: 'allow', updatedInput: input }
      : {
          behavior: 'deny',
          message: decision.reason ?? 'Denied by the operator',
          interrupt: decision.interrupt ?? false,
        }
  }

  return {
    canUseTool(toolName: string, input: unknown): Promise<PermissionResult> {
      const auto = autoDecide?.(toolName, input) ?? null
      if (auto !== null) {
        // Resolved by the autonomy ladder — the operator is never interrupted,
        // and no prompt is raised for a surface to display.
        return Promise.resolve(toResult(auto, input))
      }

      const requestId = `${sessionId}-perm-${++counter}`
      publish({
        kind: 'permission_requested',
        sessionId,
        requestId,
        toolName,
        summary: summarise(toolName, input),
        targetHost: targetHostOf(input),
        at: now(),
      })

      return new Promise<PermissionResult>((resolvePromise) => {
        outstanding.set(requestId, { settle: resolvePromise, input })
      })
    },

    resolve(requestId: string, decision: PermissionDecision): void {
      const entry = outstanding.get(requestId)
      // Unknown or already-settled: a stale click must not publish a second
      // resolution or reopen a closed prompt.
      if (entry === undefined) return
      outstanding.delete(requestId)
      publish({
        kind: 'permission_resolved',
        sessionId,
        requestId,
        decision: decision.allow ? 'allow' : 'deny',
        at: now(),
      })
      entry.settle(toResult(decision, entry.input))
    },

    rejectAll(reason: string): void {
      for (const [requestId, entry] of outstanding) {
        outstanding.delete(requestId)
        entry.settle({ behavior: 'deny', message: reason, interrupt: true })
      }
    },
  }
}
