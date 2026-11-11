import { buildReadingOrder } from './reading-order'
import { detectMovedBlocks } from './moved-blocks'
import { computeInsights, type ComputeInsightsOptions } from './insights'
import { parsePrFiles, type ParsedPrFile } from './parsed-file'
import { groupSameShapeHunks, hunkRefKey, type HunkRef } from './same-shape'
import type {
  MovedBlock,
  PrInsights,
  ReadingStep,
  SameShapeGroup,
} from '../schemas/pr-review.schema'

export interface AnalysePrResult {
  readingOrder: ReadingStep[]
  movedBlocks: MovedBlock[]
  sameShape: SameShapeGroup[]
  insights: PrInsights | null
}

/** The new-side line a hunk starts at: its first line that has one. */
function hunkLine(files: ParsedPrFile[], ref: HunkRef): number {
  const hunk = files.find((file) => file.path === ref.path)?.diff.hunks[ref.hunkIndex]
  return hunk?.lines.find((line) => line.newLineNumber != null)?.newLineNumber ?? 0
}

/** Same-shape groups as the PR detail carries them: each hunk with its line and its literals. */
function sameShapeOf(files: ParsedPrFile[]): SameShapeGroup[] {
  try {
    return groupSameShapeHunks(files).map((group) => {
      const detail = (ref: HunkRef) => ({
        ...ref,
        line: hunkLine(files, ref),
        maskedValues: group.maskedValues.get(hunkRefKey(ref)) ?? [],
      })
      return { first: detail(group.first), rest: group.rest.map(detail) }
    })
  } catch (err) {
    console.warn('[git-integration] analysePr: groupSameShapeHunks failed', err)
    return []
  }
}

/**
 * Runs the reading-order, moved-block, same-shape and insights passes for a PR's files.
 * Each patch is parsed once and shared by the passes.
 * Never throws: a failing pass falls back to an empty result and logs once.
 */
export async function analysePr(
  files: unknown[],
  opts: ComputeInsightsOptions
): Promise<AnalysePrResult> {
  const parsedFiles = parsePrFiles(files)
  let readingOrder: ReadingStep[] = []
  try {
    readingOrder = await buildReadingOrder(parsedFiles)
  } catch (err) {
    console.warn('[git-integration] analysePr: buildReadingOrder failed', err)
  }

  let movedBlocks: MovedBlock[] = []
  try {
    movedBlocks = detectMovedBlocks(parsedFiles)
  } catch (err) {
    console.warn('[git-integration] analysePr: detectMovedBlocks failed', err)
  }

  let insights: PrInsights | null = null
  try {
    insights = await computeInsights(parsedFiles, { ...opts, readingOrder })
  } catch (err) {
    console.warn('[git-integration] analysePr: computeInsights failed', err)
  }

  return { readingOrder, movedBlocks, sameShape: sameShapeOf(parsedFiles), insights }
}
