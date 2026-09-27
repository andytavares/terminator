import { buildReadingOrder } from './reading-order'
import { detectMovedBlocks } from './moved-blocks'
import { computeInsights, type ComputeInsightsOptions } from './insights'
import type { MovedBlock, PrInsights, ReadingStep } from '../schemas/pr-review.schema'

export interface AnalysePrResult {
  readingOrder: ReadingStep[]
  movedBlocks: MovedBlock[]
  insights: PrInsights | null
}

/**
 * Runs the reading-order, moved-block and insights passes for a PR's files.
 * Never throws: a failing pass falls back to an empty result and logs once.
 */
export async function analysePr(
  files: unknown[],
  opts: ComputeInsightsOptions
): Promise<AnalysePrResult> {
  let readingOrder: ReadingStep[] = []
  try {
    readingOrder = await buildReadingOrder(files)
  } catch (err) {
    console.warn('[git-integration] analysePr: buildReadingOrder failed', err)
  }

  let movedBlocks: MovedBlock[] = []
  try {
    movedBlocks = detectMovedBlocks(
      files as Array<{ filename?: string; path?: string; patch?: string }>
    )
  } catch (err) {
    console.warn('[git-integration] analysePr: detectMovedBlocks failed', err)
  }

  let insights: PrInsights | null = null
  try {
    insights = await computeInsights(files, { ...opts, readingOrder })
  } catch (err) {
    console.warn('[git-integration] analysePr: computeInsights failed', err)
  }

  return { readingOrder, movedBlocks, insights }
}
