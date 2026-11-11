import type { DiffHunk } from '../schemas/git.schema'
import type { ParsedPrFile } from './parsed-file'

const MIN_CHANGED_LINES = 2

/** String literals (any quote) mask to `S`, number literals to `N`; nothing else is masked. */
const LITERAL =
  /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?)\b/gi

export interface HunkRef {
  path: string
  hunkIndex: number
}

/** Hunks whose changed lines are identical once literals are masked; `rest` fold under `first`. */
export interface SameShapeGroup {
  key: string
  first: HunkRef
  rest: HunkRef[]
  /** Per hunk (`hunkRefKey`), the literal values masked out of its changed lines, in order. */
  maskedValues: Map<string, string[]>
}

interface HunkShape {
  ref: HunkRef
  key: string
  maskedValues: string[]
}

export function hunkRefKey(ref: HunkRef): string {
  return `${ref.path}#${ref.hunkIndex}`
}

function shapeOf(hunk: DiffHunk): { key: string; maskedValues: string[] } | null {
  const changed = hunk.lines.filter((line) => line.type !== 'context')
  if (changed.length < MIN_CHANGED_LINES) return null
  const maskedValues: string[] = []
  const mask = (literal: string, quoted?: string) => {
    maskedValues.push(literal)
    return quoted ? 'S' : 'N'
  }
  const lines = changed.map((line) => {
    const prefix = line.type === 'add' ? '+' : '-'
    const text = line.content.replace(/\s+/g, ' ').trim()
    return prefix + text.replace(LITERAL, mask)
  })
  return { key: lines.join('\n'), maskedValues }
}

function hunkShapes(files: ParsedPrFile[]): HunkShape[] {
  return files.flatMap((file) =>
    file.diff.hunks.flatMap((hunk, hunkIndex) => {
      const shape = shapeOf(hunk)
      return shape ? [{ ref: { path: file.path, hunkIndex }, ...shape }] : []
    })
  )
}

function toGroup(members: HunkShape[]): SameShapeGroup {
  const [first, ...rest] = members
  return {
    key: first.key,
    first: first.ref,
    rest: rest.map((member) => member.ref),
    maskedValues: new Map(members.map((member) => [hunkRefKey(member.ref), member.maskedValues])),
  }
}

/** Groups hunks, across and within files, whose changed lines match once literals are masked. */
export function groupSameShapeHunks(files: ParsedPrFile[]): SameShapeGroup[] {
  const byKey = new Map<string, HunkShape[]>()
  for (const shape of hunkShapes(files)) {
    byKey.set(shape.key, [...(byKey.get(shape.key) ?? []), shape])
  }
  return [...byKey.values()].filter((members) => members.length > 1).map(toGroup)
}
