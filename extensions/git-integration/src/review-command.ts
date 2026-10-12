import { remoteAccessFor } from './remote-access.js'
import { z } from 'zod'
import { defineChannel, noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'
import { VALIDATION_ERROR } from './ipc/register.js'

/** What the review window opens on; the view sends any of it, or nothing. */
export const PrReviewWindowParams = z
  .object({
    repoRoot: z.string().optional(),
    accentColor: z.string().optional(),
    prNumber: z.string().optional(),
    showOverview: z.string().optional(),
  })
  .optional()

export type PrReviewWindowParams = NonNullable<z.infer<typeof PrReviewWindowParams>>

export function openPrReviewWindow(api: ExtensionAPI, payload: PrReviewWindowParams): void {
  const params: Record<string, string> = {
    repoRoot: payload.repoRoot ?? '',
    accentColor: payload.accentColor ?? '',
  }
  if (payload.prNumber) {
    params.prNumber = payload.prNumber
    params.showOverview = payload.showOverview ?? 'false'
  }
  api.window.openAuxiliary('pr-review', params)
}

const ReviewPullRequestArgs = z.object({
  repoRoot: z.string().min(1),
  number: z.number().int().positive(),
})

/** ADR-083: another extension asks for a pull request's review by full command id. */
export function registerReviewPullRequestCommand(api: ExtensionAPI): Disposable {
  return api.commands.register(
    { id: 'review-pull-request', label: 'Review pull request', args: ReviewPullRequestArgs },
    (_ctx, args?: z.infer<typeof ReviewPullRequestArgs>) => {
      if (!args) return
      openPrReviewWindow(api, { repoRoot: args.repoRoot, prNumber: String(args.number) })
    }
  )
}

/** A submitted review changes what every open review list should show. */
export function registerReviewSubmittedRelay(api: ExtensionAPI): Disposable {
  return api.ipc.registerHandler(
    defineChannel({
      channel: 'window:review-submitted',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: () => {
        api.window.broadcast('reviews:changed', {})
        return { ok: true }
      },
    })
  )
}

const REVIEW_REPOS_KEY = 'terminator.git-integration.review.repos'

const ReviewReposArgs = z.object({
  repos: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/)).transform((repos) => [...new Set(repos)]),
})

/** The Reviews view reads the clone folder and the repository selection, and writes the selection. */
export function registerReviewSettings(api: ExtensionAPI): Disposable[] {
  return [
    api.ipc.registerHandler(
      defineChannel({
        channel: 'github:review-settings',
        schema: noPayload,
        invalid: VALIDATION_ERROR,
        run: () => {
          const repos = api.settings.get<unknown>(REVIEW_REPOS_KEY)
          return {
            cloneFolder:
              api.settings.get<string>('terminator.git-integration.review.cloneFolder') ?? '',
            repos: Array.isArray(repos) ? repos : [],
          }
        },
      }),
      remoteAccessFor('github:review-settings')
    ),
    api.ipc.registerHandler(
      defineChannel({
        channel: 'github:review-repos-set',
        schema: ReviewReposArgs,
        invalid: VALIDATION_ERROR,
        run: ({ repos }) => {
          api.settings.set(REVIEW_REPOS_KEY, repos)
          return { ok: true }
        },
      })
    ),
  ]
}
