import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Invokes one of Foundry's channels from inside its view. */
export type FoundryInvoke = (channel: string, payload?: unknown) => Promise<unknown>

/** Where Foundry keeps order `id`'s records in `repo`. */
export function liveOrderDir(repo: string, id: string): string {
  return join(repo, '.foundry', 'orders', id)
}

/** Starts the run, and checks it was accepted with something to run. */
export async function startLiveRun(foundry: FoundryInvoke, id: string): Promise<void> {
  const started = (await foundry('foundry:run.start', { id })) as {
    error?: string
    started?: boolean
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)
}

/** The run is over when it has said so: a draft, a refusal, or a gate. Null until then. */
export function liveRunOver(orderDir: string): string | null {
  const ledgerFile = join(orderDir, 'ledger.jsonl')
  const ledger = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : ''
  if (ledger.includes('ship.draft_opened')) return 'a draft is on the ledger'
  if (ledger.includes('ship.refused')) return 'shipping was refused, and said so'
  if (existsSync(join(orderDir, 'gates.json'))) return 'a gate is holding it'
  return null
}

/** One draft pull request on GitHub for the branch `worktree` is on: read back from GitHub,
 *  not the ledger, which records what the code believed. */
export function expectOneDraftPullRequest(repo: string, worktree: string): void {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree })
    .toString()
    .trim()
  const listed = execFileSync(
    'gh',
    ['pr', 'list', '--head', branch, '--json', 'url,isDraft,headRefName'],
    { cwd: repo }
  ).toString()

  console.log(`pull requests on ${branch}: ${listed}`)
  const pulls = JSON.parse(listed) as { url: string; isDraft: boolean }[]
  expect(pulls, `nothing was opened on ${branch}`).toHaveLength(1)
  expect(pulls[0].isDraft, 'it was opened, but not as a draft (FR-053)').toBe(true)
}
