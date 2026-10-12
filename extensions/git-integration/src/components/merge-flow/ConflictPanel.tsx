import React from 'react'
import type { ConflictBlock, GitAuthor } from '../../schemas/merge-flow.schema'
import { langFromBlockId, highlightLine } from '../../utils/syntax'
import { choose } from '../text'

interface DiffLine {
  line: string
  type: 'added' | 'removed' | 'common'
}

const MAX_DIFF_LINES = 300

/** The text's lines, without the empty one a trailing newline leaves. */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

interface LcsTable {
  a: string[]
  b: string[]
  dp: number[][]
}

/** dp[i][j] is the longest common subsequence of a's first i lines and b's first j. */
function lcsTable(a: string[], b: string[]): LcsTable {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return { a, b, dp }
}

/** Which way the walk back from (i, j) goes: a shared line, a line only in b, or one only in a. */
function nextStep(t: LcsTable, i: number, j: number): DiffLine['type'] {
  if (i > 0 && j > 0 && t.a[i - 1] === t.b[j - 1]) return 'common'
  if (j > 0 && (i === 0 || t.dp[i][j - 1] >= t.dp[i - 1][j])) return 'added'
  return 'removed'
}

function walkBack(t: LcsTable): DiffLine[] {
  const result: DiffLine[] = []
  let i = t.a.length
  let j = t.b.length
  while (i > 0 || j > 0) {
    const type = nextStep(t, i, j)
    if (type === 'added') result.unshift({ line: t.b[j - 1], type })
    else result.unshift({ line: t.a[i - 1], type })
    if (type !== 'added') i--
    if (type !== 'removed') j--
  }
  return result
}

function allAs(lines: string[], type: DiffLine['type']): DiffLine[] {
  return lines.map((line) => ({ line, type }))
}

function computeLineDiff(base: string, modified: string): DiffLine[] {
  const a = splitLines(base)
  const b = splitLines(modified)
  if (a.length === 0) return allAs(b, 'added')
  if (b.length === 0) return allAs(a, 'removed')
  if (a.length + b.length > MAX_DIFF_LINES) return allAs(b, 'added')
  return walkBack(lcsTable(a, b))
}

interface DiffCodeViewProps {
  contextBefore: string[]
  diffLines: DiffLine[]
  contextAfter: string[]
  side: 'ours' | 'theirs'
  lang?: string
}

interface CodeRow {
  key: string
  cls: string
  num: string
  prefix: string
  line: string
}

const DIFF_PREFIX: Record<DiffLine['type'], string> = { added: '+', removed: '-', common: ' ' }

function diffLineClass(type: DiffLine['type'], side: DiffCodeViewProps['side']): string {
  if (type === 'removed') return 'conflict-line--removed'
  if (type === 'common') return 'conflict-line--common'
  return choose(side === 'ours', 'conflict-line--ours-added', 'conflict-line--theirs-added')
}

/** Context, diff and context rows, numbered on the new side: removed lines take no number. */
function codeRows(props: DiffCodeViewProps): CodeRow[] {
  let lineNum = 1
  const next = () => String(lineNum++)
  const numberFor = (type: DiffLine['type']) => {
    if (type === 'removed') return ''
    return next()
  }
  const context = (keyPrefix: string) => (line: string, idx: number) => ({
    key: `${keyPrefix}${idx}`,
    cls: 'conflict-line--context',
    num: next(),
    prefix: ' ',
    line,
  })
  const before = props.contextBefore.map(context('b'))
  const diff = props.diffLines.map(({ line, type }, idx) => ({
    key: `d${idx}`,
    cls: diffLineClass(type, props.side),
    num: numberFor(type),
    prefix: DIFF_PREFIX[type],
    line,
  }))
  return [...before, ...diff, ...props.contextAfter.map(context('a'))]
}

function DiffCodeView(props: DiffCodeViewProps) {
  return (
    <div className="conflict-panel__diff-view">
      {codeRows(props).map((row) => (
        <div key={row.key} className={`conflict-line ${row.cls}`}>
          <span className="conflict-line__num">{row.num}</span>
          <span className="conflict-line__prefix">{row.prefix}</span>
          <span
            className="conflict-line__text hljs"
            dangerouslySetInnerHTML={{ __html: highlightLine(row.line, props.lang) || ' ' }}
          />
        </div>
      ))}
    </div>
  )
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

interface SideProps {
  side: 'ours' | 'theirs'
  label: string
  author?: GitAuthor
  selected: boolean
  onSelect: () => void
  block: ConflictBlock
}

function SideLabel({ panel: props }: { panel: SideProps }) {
  const { author } = props
  return (
    <div className={`conflict-panel__label conflict-panel__label--${props.side}`}>
      <span className="conflict-panel__label-text">{props.label}</span>
      {author && (
        <span className="conflict-panel__author">
          {author.name} · <code>{author.commitHash.slice(0, 7)}</code>
        </span>
      )}
    </div>
  )
}

function SidePanel({ panel }: { panel: SideProps }) {
  const { block, side } = panel
  const text = choose(side === 'ours', block.oursText, block.theirsText)
  const selected = choose(panel.selected, ' conflict-panel__side--selected', '')
  return (
    <div
      className={`conflict-panel__side conflict-panel__side--${side}${selected}`}
      role="button"
      tabIndex={0}
      onClick={panel.onSelect}
      onKeyDown={(e) => e.key === 'Enter' && panel.onSelect()}
    >
      <SideLabel panel={panel} />
      <DiffCodeView
        contextBefore={block.contextBefore}
        diffLines={computeLineDiff(block.baseText, text)}
        contextAfter={block.contextAfter}
        side={side}
        lang={langFromBlockId(block.blockId)}
      />
    </div>
  )
}

export function ConflictPanel(props: Props) {
  const { block, isRebase, pendingStrategy } = props
  const ours: SideProps = {
    side: 'ours',
    label: choose(isRebase, 'Theirs (branch)', 'Your version'),
    author: props.oursAuthor,
    selected: pendingStrategy === 'ours',
    onSelect: props.onSelectMine,
    block,
  }
  const theirs: SideProps = {
    side: 'theirs',
    label: choose(isRebase, 'Your version', 'Incoming changes'),
    author: props.theirsAuthor,
    selected: pendingStrategy === 'theirs',
    onSelect: props.onSelectTheirs,
    block,
  }
  return (
    <div className="conflict-panel">
      <SidePanel panel={ours} />
      <SidePanel panel={theirs} />
    </div>
  )
}
