import type { ShellExec } from './integrate.js'

// Rebasing a lane back onto its base after a predecessor merged (or the base
// otherwise moved), so the lane's own merge never fights the one that already
// landed. This is the whole of what it does: no auto-resolution, no retries —
// a conflict is handed back exactly as it was found, with the checkout left
// clean.

export type RestackResult =
  | { readonly kind: 'rebased'; readonly pushed: boolean }
  | { readonly kind: 'conflict'; readonly files: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }

export async function restack(
  lane: { cwd: string; branch: string; base: string },
  exec: ShellExec
): Promise<RestackResult> {
  const fetch = await exec({
    command: 'git',
    args: ['fetch', 'origin', lane.base],
    cwd: lane.cwd,
  })
  if (fetch.exitCode !== 0) {
    return { kind: 'failed', reason: fetch.stderr }
  }

  const rebase = await exec({
    command: 'git',
    args: ['rebase', `origin/${lane.base}`],
    cwd: lane.cwd,
  })

  if (rebase.exitCode !== 0) {
    const diff = await exec({
      command: 'git',
      args: ['diff', '--name-only', '--diff-filter=U'],
      cwd: lane.cwd,
    })
    await exec({ command: 'git', args: ['rebase', '--abort'], cwd: lane.cwd })
    const files = diff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    return { kind: 'conflict', files }
  }

  const push = await exec({
    command: 'git',
    args: ['push', '--force-with-lease', 'origin', `HEAD:${lane.branch}`],
    cwd: lane.cwd,
  })
  if (push.exitCode !== 0) {
    return { kind: 'failed', reason: push.stderr }
  }
  return { kind: 'rebased', pushed: push.exitCode === 0 }
}
