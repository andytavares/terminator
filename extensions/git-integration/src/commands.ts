import type { ExtensionAPI, Disposable, CommandContext } from '../../../src/main/extensions/api.js'
import { pushBranch, pullFastForward } from './git/git-service.js'

const PUSH_ERROR_MESSAGES: Record<string, string> = {
  NO_UPSTREAM: 'Push failed — no upstream branch set.',
  REJECTED: 'Push rejected — pull changes first.',
}

export function registerQuickActionCommands(api: ExtensionAPI): Disposable[] {
  const disposables: Disposable[] = []

  disposables.push(
    api.commands.register(
      { id: 'commit', label: 'Commit…', mnemonic: 'c', requires: 'repo', category: 'Git' },
      (ctx: CommandContext) => {
        if (!ctx.repoRoot) return
        api.window.showSelf('project')
        api.window.broadcast('git:focus-commit-message', { repoRoot: ctx.repoRoot })
      }
    )
  )

  disposables.push(
    api.commands.register(
      { id: 'push', label: 'Push', mnemonic: 'p', requires: 'repo', category: 'Git' },
      async (ctx: CommandContext) => {
        if (!ctx.repoRoot) return
        const result = await pushBranch(ctx.repoRoot)
        if ('error' in result) {
          api.notifications.showToast(
            'error',
            PUSH_ERROR_MESSAGES[result.error] ?? `Push failed: ${result.error}`,
            'pushFailed'
          )
          return
        }
        api.notifications.showToast(
          'success',
          `Pushed ${result.branch} to ${result.remote}`,
          'pushSucceeded'
        )
      }
    )
  )

  disposables.push(
    api.commands.register(
      { id: 'pull', label: 'Pull', mnemonic: 'l', requires: 'repo', category: 'Git' },
      async (ctx: CommandContext) => {
        if (!ctx.repoRoot) return
        const result = await pullFastForward(ctx.repoRoot)
        if ('error' in result) {
          api.notifications.showToast('error', `Pull failed: ${result.error}`, 'pullFailed')
          return
        }
        api.notifications.showToast('success', `Pulled ${result.branch}`, 'pullSucceeded')
      }
    )
  )

  disposables.push(
    api.commands.register(
      { id: 'create-pr', label: 'Create PR…', mnemonic: 'r', requires: 'repo', category: 'Git' },
      (ctx: CommandContext) => {
        if (!ctx.repoRoot) return
        api.window.showSelf('project')
        api.window.broadcast('git:open-pr-dialog', { repoRoot: ctx.repoRoot })
      }
    )
  )

  return disposables
}
