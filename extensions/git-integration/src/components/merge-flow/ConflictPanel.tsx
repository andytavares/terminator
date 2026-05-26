import React from 'react'
import type { ConflictBlock, GitAuthor } from '../../schemas/merge-flow.schema'
import { langFromBlockId, highlightLine } from '../../utils/syntax'

interface DiffLine {
  line: string
  type: 'added' | 'removed' | 'common'
}

const MAX_DIFF_LINES = 300

function computeLineDiff(base: string, modified: string): DiffLine[] {
  const split = (s: string) => {
    const lines = s.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }
  const a = split(base)
  const b = split(modified)

  if (a.length === 0) return b.map((line) => ({ line, type: 'added' as const }))
  if (b.length === 0) return a.map((line) => ({ line, type: 'removed' as const }))
  if (a.length + b.length > MAX_DIFF_LINES) {
    return b.map((line) => ({ line, type: 'added' as const }))
  }

  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const result: DiffLine[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ line: a[i - 1], type: 'common' })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ line: b[j - 1], type: 'added' })
      j--
    } else {
      result.unshift({ line: a[i - 1], type: 'removed' })
      i--
    }
  }
  return result
}

interface DiffCodeViewProps {
  contextBefore: string[]
  diffLines: DiffLine[]
  contextAfter: string[]
  side: 'ours' | 'theirs'
  lang?: string
}

function DiffCodeView({ contextBefore, diffLines, contextAfter, side, lang }: DiffCodeViewProps) {
  let lineNum = 1
  const rows: React.ReactNode[] = []

  contextBefore.forEach((line, idx) => {
    rows.push(
      <div key={`b${idx}`} className="conflict-line conflict-line--context">
        <span className="conflict-line__num">{lineNum++}</span>
        <span className="conflict-line__prefix"> </span>
        <span
          className="conflict-line__text hljs"
          dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) || ' ' }}
        />
      </div>
    )
  })

  diffLines.forEach(({ line, type }, idx) => {
    const addedClass = side === 'ours' ? 'conflict-line--ours-added' : 'conflict-line--theirs-added'
    const cls =
      type === 'added'
        ? addedClass
        : type === 'removed'
          ? 'conflict-line--removed'
          : 'conflict-line--common'
    const prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' '
    const num = type === 'removed' ? '' : String(lineNum++)
    rows.push(
      <div key={`d${idx}`} className={`conflict-line ${cls}`}>
        <span className="conflict-line__num">{num}</span>
        <span className="conflict-line__prefix">{prefix}</span>
        <span
          className="conflict-line__text hljs"
          dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) || ' ' }}
        />
      </div>
    )
  })

  contextAfter.forEach((line, idx) => {
    rows.push(
      <div key={`a${idx}`} className="conflict-line conflict-line--context">
        <span className="conflict-line__num">{lineNum++}</span>
        <span className="conflict-line__prefix"> </span>
        <span
          className="conflict-line__text hljs"
          dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) || ' ' }}
        />
      </div>
    )
  })

  return <div className="conflict-panel__diff-view">{rows}</div>
}

interface Props {
  block: ConflictBlock
  isRebase: boolean
  pendingStrategy: string | null
  oursAuthor?: GitAuthor
  theirsAuthor?: GitAuthor
  onSelectMine: () => void
  onSelectTheirs: () => void
}

export function ConflictPanel({
  block,
  isRebase,
  pendingStrategy,
  oursAuthor,
  theirsAuthor,
  onSelectMine,
  onSelectTheirs,
}: Props) {
  const mineLabel = isRebase ? 'Theirs (branch)' : 'Your version'
  const theirsLabel = isRebase ? 'Your version' : 'Incoming changes'

  const lang = langFromBlockId(block.blockId)
  const oursDiff = computeLineDiff(block.baseText, block.oursText)
  const theirsDiff = computeLineDiff(block.baseText, block.theirsText)

  return (
    <div className="conflict-panel">
      <div
        className={`conflict-panel__side conflict-panel__side--ours${pendingStrategy === 'ours' ? ' conflict-panel__side--selected' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onSelectMine}
        onKeyDown={(e) => e.key === 'Enter' && onSelectMine()}
      >
        <div className="conflict-panel__label conflict-panel__label--ours">
          <span className="conflict-panel__label-text">{mineLabel}</span>
          {oursAuthor && (
            <span className="conflict-panel__author">
              {oursAuthor.name} · <code>{oursAuthor.commitHash.slice(0, 7)}</code>
            </span>
          )}
        </div>
        <DiffCodeView
          contextBefore={block.contextBefore}
          diffLines={oursDiff}
          contextAfter={block.contextAfter}
          side="ours"
          lang={lang}
        />
      </div>

      <div
        className={`conflict-panel__side conflict-panel__side--theirs${pendingStrategy === 'theirs' ? ' conflict-panel__side--selected' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onSelectTheirs}
        onKeyDown={(e) => e.key === 'Enter' && onSelectTheirs()}
      >
        <div className="conflict-panel__label conflict-panel__label--theirs">
          <span className="conflict-panel__label-text">{theirsLabel}</span>
          {theirsAuthor && (
            <span className="conflict-panel__author">
              {theirsAuthor.name} · <code>{theirsAuthor.commitHash.slice(0, 7)}</code>
            </span>
          )}
        </div>
        <DiffCodeView
          contextBefore={block.contextBefore}
          diffLines={theirsDiff}
          contextAfter={block.contextAfter}
          side="theirs"
          lang={lang}
        />
      </div>
    </div>
  )
}
