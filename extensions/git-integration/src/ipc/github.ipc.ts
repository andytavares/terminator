import type { GithubAccess } from '../github/gh-cli.js'
import { withTiming, type RegisterFn } from './register.js'
import { githubContext, type GithubHandlerOptions } from './github/context.js'
import { prQueueChannels } from './github/pr-queue.js'
import { prDetailChannels } from './github/pr-detail.js'
import { prActionChannels } from './github/pr-actions.js'
import { prFileChannels } from './github/pr-files.js'
import { prCommentChannels } from './github/pr-comments.js'
import { reviewSessionChannels } from './github/sessions.js'
import { dashboardChannels } from './github/dashboard.js'
import { contributionsChannels } from './github/contributions.js'
import { viewedChannels } from './github/viewed.js'

export type { GithubHandlerOptions } from './github/context.js'

/** Registers every github:* channel. Each registration has its own caches (the repository owner and
 *  name, the viewer's login, merge bases, the accessible repositories). */
export function registerGithubHandlers(
  registerRaw: RegisterFn,
  access: GithubAccess,
  options: GithubHandlerOptions = {}
): void {
  const register = withTiming(registerRaw)
  const ctx = githubContext(access, options)
  const channels = [
    ...prActionChannels(ctx),
    ...prQueueChannels(ctx),
    ...prDetailChannels(ctx),
    ...prFileChannels(ctx),
    ...prCommentChannels(ctx),
    ...reviewSessionChannels(ctx),
    ...dashboardChannels(ctx),
    ...contributionsChannels(ctx),
    ...viewedChannels(ctx),
  ]
  for (const spec of channels) register(spec)
}
