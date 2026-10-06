import { z } from 'zod'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api.js'

export interface PrReviewWindowParams {
  repoRoot?: string
  accentColor?: string
  prNumber?: string
  showOverview?: string
}

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
