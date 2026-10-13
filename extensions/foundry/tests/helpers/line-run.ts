/**
 * An agreed order and agents that do its work, for specs that run the Line
 * end to end over `foundry-host.ts`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { realGit, seededRepository, type fakeRunner } from './foundry-host.js'
import { builderUnit, testCriterion } from './order-parts.js'

/** A seeded repository whose `origin` is a bare repository beside it, so pushes land. */
export async function repositoryWithRemote(parent: string): Promise<string> {
  const repo = await seededRepository(parent)
  const origin = path.join(parent, 'origin.git')
  await realGit({ command: 'git', args: ['init', '-q', '--bare', origin], cwd: parent })
  await realGit({ command: 'git', args: ['remote', 'add', 'origin', origin], cwd: repo })
  await realGit({ command: 'git', args: ['push', '-q', 'origin', 'main'], cwd: repo })
  return repo
}

/** One unit in one lane, checked by the repository's own `npm test`. */
export function agreedOrder(repo: string, over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: over.id ?? 'WO-1',
    title: 'Make it red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-10-12T10:00:00.000Z',
  })
  const test = { command: 'npm test', source: 'package.json' }
  return {
    ...base,
    status: 'agreed',
    agreedAt: '2026-10-12T10:01:00.000Z',
    intent: { problem: 'text is blue', outcome: 'text is red', nonGoals: [] },
    context: { ...base.context, toolchain: { ...base.context.toolchain, test } },
    acceptance: [testCriterion('AC-1', { statement: 'text is red' })],
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'red text', satisfies: ['AC-1'], touches: ['red.css'] })],
    },
    ...over,
  } as WorkOrder
}

/** Every agent ends its turn at once. A builder leaves `<order id>.css` in its checkout, so each
 * order's change is its own. */
export function agentsAnswer(runner: ReturnType<typeof fakeRunner>, transcripts: string): void {
  runner.start.mockImplementation((async (input: {
    phase: string
    featureDir: string
    worktreePath: string
    onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
    onTurnEnd: (turns: number) => void
  }) => {
    const sessionId = `${input.phase}-${Math.random().toString(36).slice(2, 8)}`
    if (input.phase === 'builder') {
      const file = `${path.basename(input.featureDir).toLowerCase()}.css`
      fs.writeFileSync(path.join(input.worktreePath, file), 'a { color: red }\n')
    }
    input.onRegistered({ sessionId, transcriptFrom: 0 })
    setTimeout(() => input.onTurnEnd(1), 0)
    return {
      sessionId,
      transcriptFrom: 0,
      terminalSessionId: `term-${sessionId}`,
      transcriptPath: path.join(transcripts, `${sessionId}.jsonl`),
    }
  }) as never)
}

/** A GitHub check run, as `gh pr checks --json` reports it. */
export function checks(bucket: 'pass' | 'fail', run = 1): string {
  const link = `https://github.com/owner/app/actions/runs/${run}/job/1`
  return JSON.stringify([{ name: 'ci', bucket, link, workflow: 'ci' }])
}
