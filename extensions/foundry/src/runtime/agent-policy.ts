import type { ExtensionAPI } from '@terminator/extension-sdk'

import { decideReadOnly } from './read-only-policy.js'
import { readShell } from './shell-split.js'
import { ensureTrusted } from './workspace-trust.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'

/**
 * Make sure the repository an agent is about to work in is trusted, and say so.
 *
 * Recorded rather than done quietly: amending the operator's own Claude Code
 * configuration is a thing they should be able to find in the ledger, even
 * though it is the answer they would have given the dialog themselves.
 */
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

/**
 * Whether this is one of the commands the toolchain probe actually found.
 *
 * Exactly, after trimming — not a prefix, not with arguments appended. The
 * point is that a role which may run the project's tests may run *the project's
 * tests*, not anything beginning with the same word.
 */
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

  // Per segment, because a verdict from an exit status is the whole point and
  // an exit status is something you have to ask for. Watched live: a verifier
  // ran `npm test; echo "EXIT=$?"` — the plainest way there is to capture what
  // FR-033 says the verdict must come from — and a whole-command match refused
  // it, naming `npm` as not being on the review's list.
  //
  // One segment has to be a command this project actually declared, and every
  // other segment has to stand on its own under the read-only policy. So
  // `npm test; echo "EXIT=$?"` is allowed and `npm test; rm -rf .` is not.
  const segments = readShell(command).segments
  return (
    segments.some((segment) => probed.has(segment)) &&
    segments.every(
      (segment) => probed.has(segment) || decideReadOnly('Bash', { command: segment }).allow
    )
  )
}

/**
 * What a read-only turn in the Forge may do: read anything the policy allows,
 * and write exactly one file — the proposal, or a rung's output.
 *
 * Both ways, never abstaining: an allowed read held for five minutes by an
 * abstention is the same as a refused one, from the agent's side.
 */
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
