import type { ExtensionAPI } from '@terminator/extension-sdk'
import { moveFromUserData } from '@terminator/extension-sdk/node'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { DEFAULT_DIR_NAME } from './data-root.js'

// What earlier builds kept in the shared userData folder, and where it lives
// in Foundry's own `api.paths.globalStorage` now (ADR 103).
const MOVES = [
  { from: 'foundry', to: 'records' },
  { from: 'foundry-runtime', to: 'runtime' },
]

/** Where the records go with no workspace open and no data directory set. */
export function fallbackRecordsBase(api: ExtensionAPI): string {
  return path.join(api.paths.globalStorage, 'records')
}

/**
 * Moves Foundry's data out of the shared userData folder on the first
 * activation after the change, then reconnects the lane worktrees that moved
 * with the records, in the background.
 */
export function moveFromSharedUserData(api: ExtensionAPI): void {
  const [records] = moveFromUserData(api, MOVES)
  if (records !== 'moved') return
  void reconnectLaneWorktrees(api, path.join(fallbackRecordsBase(api), DEFAULT_DIR_NAME))
}

// A repository records each worktree's path; `git worktree repair` run inside
// a moved worktree records the new one, or `git worktree prune` deletes it.
async function reconnectLaneWorktrees(api: ExtensionAPI, root: string): Promise<void> {
  for (const lane of laneWorktrees(root)) {
    const result = await api.shell
      .exec({ command: 'git', args: ['worktree', 'repair'], cwd: lane })
      .catch((error: Error) => ({ exitCode: 1, stderr: error.message }))
    if (result.exitCode !== 0) {
      api.log.warn(`Could not reconnect the lane worktree ${lane}: ${result.stderr.trim()}`)
    }
  }
}

/** `<root>/orders/<id>/worktrees/<repo>`, the shape `checkoutPath` builds. */
function laneWorktrees(root: string): string[] {
  const orders = path.join(root, 'orders')
  return entries(orders).flatMap((order) => {
    const worktrees = path.join(orders, order, 'worktrees')
    return entries(worktrees).map((repo) => path.join(worktrees, repo))
  })
}

function entries(directory: string): string[] {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : []
}
