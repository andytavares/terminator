/** The Forge's intake turns as specs drive them through `activate`: a draft worth reviewing,
 * and agents that answer by writing the one file each is allowed to write. */
import * as path from 'node:path'
import { builderUnit, testCriterion } from './order-parts.js'
import type { FoundryHost } from './foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import { rungOutputPath } from '../../src/line/rung-output.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { writeFileWithDirs } from './files.js'

export type ForgePhase = 'architect' | 'red-team' | 'scout'

export interface ForgeTurnInput {
  phase: ForgePhase
  onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
  onTurnEnd: () => void
  onEnd: (exitCode: number | null) => void
}

/** What the scripted agents do, read at each turn: the records, what each role writes on its
 * turn (a role with no entry writes nothing), and a role whose turn waits for `release`. */
export interface TurnScript {
  dataDir: string
  writes: Partial<Record<ForgePhase, (turn: number) => unknown>>
  heldTurn?: { phase: ForgePhase; release: Promise<void> } | null
}

/** WO-1 in `repo`, a draft that passes every check but the red team's, unless `over` says not. */
export function readyDraft(repo: string, over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make it red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-10-12T10:00:00.000Z',
  })
  const unit = builderUnit('U-1', { title: 'red text', satisfies: ['AC-1'], touches: ['src/a.ts'] })
  return {
    ...base,
    intent: { problem: 'text is blue', outcome: 'text is red', nonGoals: ['icons'] },
    context: { ...base.context, entryPoints: ['src/theme.ts'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'all text renders red' })],
    plan: { ...base.plan, units: [unit] },
    ...over,
  }
}

/** Saves `order` and asks the Forge to converge it; what the channel answered. */
export async function convergeOrder(host: FoundryHost, dataDir: string, order: WorkOrder) {
  await createOrderStore(dataDir).save(order)
  const answer = await host.call('foundry:order.converge', {
    id: 'WO-1',
    message: 'tighten the plan',
  })
  return answer as { error?: string; converging?: string }
}

/** A finding the red team raises: a high-severity regression. */
export function redTeamRegression(text: string) {
  return { severity: 'high', category: 'regression', text }
}

/** The one file a turn of `phase` may write: the architect's proposal, or a rung's output. */
export function forgeAnswerPath(dataDir: string, phase: ForgePhase, turn: number): string {
  const order = orderDir(dataDir, 'WO-1')
  if (phase === 'architect') return path.join(order, 'proposal.json')
  return rungOutputPath(order, phase === 'scout' ? 'forge-scout' : `review-${turn}`)
}

/** Ends a turn: its answer is in, and a turn that wrote nothing is over when its session ends. */
function endTurn(input: ForgeTurnInput, wrote: boolean): void {
  input.onTurnEnd()
  if (!wrote) input.onEnd(0)
}

/** Agents that write what `script()` says for their role and turn, then end the turn. */
export function scriptedTurns(script: () => TurnScript) {
  const turns = new Map<string, number>()
  return async (input: ForgeTurnInput) => {
    const turn = (turns.get(input.phase) ?? 0) + 1
    turns.set(input.phase, turn)
    const { dataDir, writes, heldTurn } = script()
    const sessionId = `${input.phase}-${turn}`
    const written = writes[input.phase]?.(turn)
    if (written !== undefined)
      writeFileWithDirs(forgeAnswerPath(dataDir, input.phase, turn), written)
    input.onRegistered({ sessionId, transcriptFrom: 0 })
    const wait = heldTurn?.phase === input.phase ? heldTurn.release : Promise.resolve()
    void wait.then(() => setTimeout(() => endTurn(input, written !== undefined), 0))
    return { sessionId, transcriptFrom: 0, terminalSessionId: 't', transcriptPath: '/none' }
  }
}
