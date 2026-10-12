import { parseDiff } from '../github/pr-review-service'
import type { FileDiff } from '../schemas/git.schema'

interface RawPrFile {
  filename?: string
  path?: string
  additions?: number
  deletions?: number
  patch?: string
}

/** A changed file of a PR with its patch parsed once, for every analysis pass to share. */
export interface ParsedPrFile {
  path: string
  additions: number
  deletions: number
  patch?: string
  diff: FileDiff
}

/** Parses each file's patch exactly once; GitHub sends `filename`, local callers `path`. */
export function parsePrFiles(files: unknown[]): ParsedPrFile[] {
  return (files as RawPrFile[]).map((file) => {
    const path = file.path ?? file.filename ?? ''
    return {
      path,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      patch: file.patch,
      diff: parseDiff(file.patch ?? '', path),
    }
  })
}
