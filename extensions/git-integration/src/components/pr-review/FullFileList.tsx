import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { PrReviewDetail, Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import { chapterRiskLevel } from '../../github/pr-review-service'
import { choose } from '../text'
import {
  classNames,
  currentAttr,
  orderedFiles,
  rowState,
  RowStateLabel,
  RowStateMark,
  type SinceSets,
} from './file-rows'

interface Props {
  pr: PrReviewDetail
  repoRoot: string
  headSHA: string
  currentFilePath: string | null
  onSelectFile: (path: string, chapterId: string) => void
  showChapterHeaders?: boolean
}

type ChapterStatus = 'not-started' | 'in-progress' | 'complete'

interface ReadingReason {
  reason: string
  allUsesViewed: boolean
}

/** Each file's place in the reading order, and whether every definition it uses was viewed. */
function readingReasons(
  readingOrder: PrReviewDetail['readingOrder'],
  viewedFiles: Set<string>
): Map<string, ReadingReason> {
  const map = new Map<string, ReadingReason>()
  for (const step of readingOrder ?? []) {
    const allUsesViewed = step.uses.every(
      (u) => u.definedInPath == null || viewedFiles.has(u.definedInPath)
    )
    map.set(step.path, { reason: step.reason, allUsesViewed })
  }
  return map
}

function chapterStatus(ch: Chapter, viewedFiles: Set<string>): ChapterStatus {
  const viewed = ch.files.filter((f) => viewedFiles.has(f.path)).length
  if (viewed === 0) return 'not-started'
  if (viewed === ch.files.length) return 'complete'
  return 'in-progress'
}

/** What the list shares with every chapter and row. */
interface ListContext {
  sets: SinceSets
  reasons: Map<string, ReadingReason>
  currentFilePath: string | null
  onSelectFile: Props['onSelectFile']
}

function ChapterRisk({ chapter }: { chapter: Chapter }) {
  // A chapter of only generated files and lock files (tier 3) is not scored.
  if (!chapter.files.some((f) => f.tier !== 3)) {
    return <span className="full-file-chapter-risk full-file-chapter-risk--none">auto</span>
  }
  const level = chapterRiskLevel(chapter)
  return <span className={`full-file-chapter-risk full-file-chapter-risk--${level}`}>{level}</span>
}

interface ChapterHeaderProps {
  chapter: Chapter
  num: number
  status: ChapterStatus
  isOpen: boolean
  progress: string
  onToggle: () => void
}

function ChapterHeader(props: ChapterHeaderProps) {
  const { status } = props
  return (
    <button
      aria-expanded={props.isOpen}
      className="full-file-chapter-header"
      onClick={props.onToggle}
    >
      <span className={`full-file-chapter-status full-file-chapter-status--${status}`} />
      <span className="full-file-chapter-num">Chapter {props.num}</span>
      <span className="full-file-chapter-name">{props.chapter.name}</span>
      <ChapterRisk chapter={props.chapter} />
      <span className="full-file-chapter-progress">{props.progress}</span>
      {status === 'complete' && <Check aria-hidden="true" className="full-file-chapter-done" />}
      {props.isOpen && <ChevronDown aria-hidden="true" className="full-file-chapter-chevron" />}
      {!props.isOpen && <ChevronRight aria-hidden="true" className="full-file-chapter-chevron" />}
    </button>
  )
}

function rowRiskClass(file: PrChangedFile): string {
  const level = choose(file.tier === 3, 'none', file.riskScore.level)
  return `full-file-row-risk full-file-row-risk--${level}`
}

function RowReason({ info }: { info: ReadingReason | undefined }) {
  if (!info) return null
  const viewed = choose(info.allUsesViewed, ' rc-frow-reason--viewed', '')
  return <span className={`rc-frow-reason${viewed}`}>{info.reason}</span>
}

function FullRowBody({ file, reason }: { file: PrChangedFile; reason: ReadingReason | undefined }) {
  return (
    <>
      <span className={rowRiskClass(file)} />
      <span className="full-file-row-body">
        <span className="full-file-row-name">{file.path.split('/').pop()}</span>
        <RowReason info={reason} />
      </span>
      <span className="full-file-row-changes">
        <span className="full-file-row-add">+{file.additions}</span>
        <span className="full-file-row-del">−{file.deletions}</span>
      </span>
    </>
  )
}

function FullFileRow(props: {
  file: PrChangedFile
  num: number
  chapterId: string
  ctx: ListContext
}) {
  const { file, ctx } = props
  const isActive = file.path === ctx.currentFilePath
  const state = rowState(file, ctx.sets)
  const className = classNames('full-file-row', {
    'full-file-row--active': isActive,
    'full-file-row--viewed': ctx.sets.viewedFiles.has(file.path),
  })
  return (
    <button
      aria-current={currentAttr(isActive)}
      className={className}
      onClick={() => ctx.onSelectFile(file.path, props.chapterId)}
      title={file.path}
    >
      <RowStateMark state={state} num={props.num} numClass="full-file-row-num" />
      <FullRowBody file={file} reason={ctx.reasons.get(file.path)} />
      <RowStateLabel state={state} />
    </button>
  )
}

interface ChapterSectionProps {
  chapter: Chapter
  num: number
  ctx: ListContext
  files: PrChangedFile[]
  headers: { show: boolean; isOpen: boolean; onToggle: () => void }
}

function ChapterSection(props: ChapterSectionProps) {
  const { chapter, ctx, files, headers } = props
  const status = chapterStatus(chapter, ctx.sets.viewedFiles)
  const viewedInChapter = files.filter((f) => ctx.sets.viewedFiles.has(f.path)).length
  return (
    <div className={`full-file-chapter full-file-chapter--${status}`}>
      {headers.show && (
        <ChapterHeader
          chapter={chapter}
          num={props.num}
          status={status}
          isOpen={headers.isOpen}
          progress={`${viewedInChapter}/${files.length}`}
          onToggle={headers.onToggle}
        />
      )}
      {(!headers.show || headers.isOpen) &&
        files.map((file, fi) => (
          <FullFileRow key={file.path} file={file} num={fi + 1} chapterId={chapter.id} ctx={ctx} />
        ))}
    </div>
  )
}

/** Which chapters are folded; every chapter starts open. */
function useCollapsed(pr: PrReviewDetail) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pr.chapters.map((c) => [c.id, false]))
  )
  const toggleChapterCollapsed = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  return { collapsed, toggle: toggleChapterCollapsed }
}

function useListContext(props: Props) {
  const { pr } = props
  const {
    viewedFiles,
    fileOrderOverrides,
    changedSince = new Set<string>(),
    newSinceLook = new Set<string>(),
  } = usePrReviewStore()
  const reasons = useMemo(
    () => readingReasons(pr.readingOrder, viewedFiles),
    [pr.readingOrder, viewedFiles]
  )
  const sets = { viewedFiles, changedSince, newSinceLook }
  const ctx: ListContext = {
    sets,
    reasons,
    currentFilePath: props.currentFilePath,
    onSelectFile: props.onSelectFile,
  }
  return { ctx, fileOrderOverrides }
}

export function FullFileList(props: Props) {
  const { pr } = props
  const show = props.showChapterHeaders ?? true
  const { ctx, fileOrderOverrides } = useListContext(props)
  const { collapsed, toggle } = useCollapsed(pr)
  return (
    <div className="full-file-list">
      {pr.chapters.map((chapter, ci) => (
        <ChapterSection
          key={chapter.id}
          chapter={chapter}
          num={ci + 1}
          ctx={ctx}
          files={orderedFiles(chapter, fileOrderOverrides[chapter.id])}
          headers={{ show, isOpen: !collapsed[chapter.id], onToggle: () => toggle(chapter.id) }}
        />
      ))}
    </div>
  )
}
