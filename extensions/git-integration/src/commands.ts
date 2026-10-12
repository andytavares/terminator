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

export function registerQuickActionCommands(api: ExtensionAPI): Disposable[] {
  const disposables: Disposable[] = []

  disposables.push(
    api.commands.register(
      { id: 'commit', label: 'Commit…', mnemonic: 'c', requires: 'repo', category: 'Git' },
      (ctx: CommandContext) => {
        if (ctx.repoRoot) requestOfView(api, { kind: 'commit', repoRoot: ctx.repoRoot })
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
        if (ctx.repoRoot) requestOfView(api, { kind: 'pull-request', repoRoot: ctx.repoRoot })
      }
    )
  )

  return disposables
}
