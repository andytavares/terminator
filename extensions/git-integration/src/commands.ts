import type { ExtensionAPI, Disposable, CommandContext } from '@terminator/extension-sdk'
import { pushBranch, pullFastForward } from './git/git-service.js'

const PUSH_ERROR_MESSAGES: Record<string, string> = {
  NO_UPSTREAM: 'Push failed — no upstream branch set.',
  REJECTED: 'Push rejected — pull changes first.',
}

/** Shows the project view and asks it to do something for the command's repository. */
function viewCommand(api: ExtensionAPI, event: string) {
  return (ctx: CommandContext) => {
    if (!ctx.repoRoot) return
    api.window.showSelf('project')
    api.window.broadcast(event, { repoRoot: ctx.repoRoot })
  }
}

function pushCommand(api: ExtensionAPI) {
  return async (ctx: CommandContext) => {
    if (!ctx.repoRoot) return
    const result = await pushBranch(ctx.repoRoot)
    if ('error' in result) {
      const message = PUSH_ERROR_MESSAGES[result.error] ?? `Push failed: ${result.error}`
      api.notifications.showToast('error', message, 'pushFailed')
      return
    }
    const message = `Pushed ${result.branch} to ${result.remote}`
    api.notifications.showToast('success', message, 'pushSucceeded')
  }
}

function pullCommand(api: ExtensionAPI) {
  return async (ctx: CommandContext) => {
    if (!ctx.repoRoot) return
    const result = await pullFastForward(ctx.repoRoot)
    if ('error' in result) {
      api.notifications.showToast('error', `Pull failed: ${result.error}`, 'pullFailed')
      return
    }
    api.notifications.showToast('success', `Pulled ${result.branch}`, 'pullSucceeded')
  }
}

const GIT_COMMAND = { requires: 'repo', category: 'Git' } as const

export function registerQuickActionCommands(api: ExtensionAPI): Disposable[] {
  const register: ExtensionAPI['commands']['register'] = (spec, handler) =>
    api.commands.register(spec, handler)
  return [
    register(
      { id: 'commit', label: 'Commit…', mnemonic: 'c', ...GIT_COMMAND },
      viewCommand(api, 'git:focus-commit-message')
    ),
    register({ id: 'push', label: 'Push', mnemonic: 'p', ...GIT_COMMAND }, pushCommand(api)),
    register({ id: 'pull', label: 'Pull', mnemonic: 'l', ...GIT_COMMAND }, pullCommand(api)),
    register(
      { id: 'create-pr', label: 'Create PR…', mnemonic: 'r', ...GIT_COMMAND },
      viewCommand(api, 'git:open-pr-dialog')
    ),
  ]
}
