import type { ExtensionAPI } from '@terminator/extension-sdk'

import { decideReadOnly } from './read-only-policy.js'
import { readShell } from './shell-split.js'
import { ensureTrusted } from './workspace-trust.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'

// Make sure the repository an agent will work in is trusted, and record it: the
// operator's Claude Code configuration was amended, and the ledger should say so.
export function trustRepository(
  api: ExtensionAPI,
  repoRoot: string,
  { orderId, store }: { orderId: string; store: { record: (entry: LedgerEntry) => Promise<void> } }
): void {
  const result = ensureTrusted(repoRoot)
  if (!result.changed) {
    if (result.reason === 'could not write') {
      api.log.error(
        `Foundry could not mark ${repoRoot} trusted; its agents will stop at the trust dialog.`
      )
    }
    return
  }
  void store
    .record({
      at: new Date().toISOString(),
      orderId,
      actor: 'rule:line',
      action: 'workspace.trusted',
      subject: repoRoot,
      reason:
        'Claude Code shows its trust dialog for a directory it has not seen, and an agent waiting at one never starts.',
      evidence: [],
    })
    .catch(() => undefined)
}

// Whether this is exactly a command the toolchain probe found, after trimming: a role
// that may run the project's tests may run those, not anything sharing the first word.
export function isProbedCommand(order: WorkOrder, tool: string, input: unknown): boolean {
  if (tool !== 'Bash') return false
  const command =
    typeof input === 'object' && input !== null
      ? (input as { command?: unknown }).command
      : undefined
  if (typeof command !== 'string') return false

  const probed = new Set(
    Object.values(order.context.toolchain)
      .filter((found) => found !== null)
      .map((found) => found.command.trim())
  )
  if (probed.size === 0) return false

  // Per segment, so `npm test; echo "EXIT=$?"` (capturing the exit status FR-033 wants)
  // is allowed: one segment is a declared command and every other must pass the
  // read-only policy alone, so `npm test; rm -rf .` is not.
  const segments = readShell(command).segments
  return (
    segments.some((segment) => probed.has(segment)) &&
    segments.every(
      (segment) => probed.has(segment) || decideReadOnly('Bash', { command: segment }).allow
    )
  )
}

// A read-only Forge turn: read what the policy allows and write exactly one file (the
// proposal or a rung's output). Never abstains: a read held five minutes is a refusal.
export function readOnlyAutoDecide(
  writablePath: string
): (tool: string, toolInput: unknown) => { allow: boolean; reason?: string } {
  return (tool, toolInput) => {
    const target = (toolInput as { file_path?: unknown } | null)?.file_path
    if (typeof target === 'string' && target === writablePath) return { allow: true }
    const decision = decideReadOnly(tool, toolInput)
    return { allow: decision.allow, reason: decision.reason }
  }
}
