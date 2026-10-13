import type { ExtensionAPI, Disposable, CommandContext } from '@terminator/extension-sdk'
import { pushBranch, pullFastForward } from './git/git-service.js'

const PUSH_ERROR_MESSAGES: Record<string, string> = {
  NO_UPSTREAM: 'Push failed — no upstream branch set.',
  REJECTED: 'Push rejected — pull changes first.',
}

/** What a command asked the Git view to do, kept for a view that does not exist yet. */
export interface ViewRequest {
  kind: 'commit' | 'pull-request'
  repoRoot: string
}

const VIEW_REQUEST_CHANNEL: Record<ViewRequest['kind'], string> = {
  commit: 'git:focus-commit-message',
  'pull-request': 'git:open-pr-dialog',
}
const PENDING_REQUEST_MS = 5000
let pendingRequest: ViewRequest | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Brings the Git tab forward and asks its view to act. A view that is already
 * open hears the broadcast; one the tab is only now creating collects the
 * request on mount (consumePendingViewRequest), within five seconds, the shape
 * Notepad and Foundry use for the same race.
 */
function requestOfView(api: ExtensionAPI, request: ViewRequest): void {
  api.window.showSelf('project')
  api.window.broadcast(VIEW_REQUEST_CHANNEL[request.kind], { repoRoot: request.repoRoot })
  pendingRequest = request
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingRequest = null
    pendingTimer = null
  }, PENDING_REQUEST_MS)
}

/** The request a command left for the Git view, once. */
export function consumePendingViewRequest(): ViewRequest | null {
  const request = pendingRequest
  pendingRequest = null
  return request
}

/** Asks the Git view to act on the command's repository. */
function viewCommand(api: ExtensionAPI, kind: ViewRequest['kind']) {
  return (ctx: CommandContext) => {
    if (ctx.repoRoot) requestOfView(api, { kind, repoRoot: ctx.repoRoot })
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
      viewCommand(api, 'commit')
    ),
    register({ id: 'push', label: 'Push', mnemonic: 'p', ...GIT_COMMAND }, pushCommand(api)),
    register({ id: 'pull', label: 'Pull', mnemonic: 'l', ...GIT_COMMAND }, pullCommand(api)),
    register(
      { id: 'create-pr', label: 'Create PR…', mnemonic: 'r', ...GIT_COMMAND },
      viewCommand(api, 'pull-request')
    ),
  ]
}
