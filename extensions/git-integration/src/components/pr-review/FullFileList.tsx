import React, { useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { PrReviewDetail, Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import {
  classNames,
  currentAttr,
  FileRowContent,
  orderedFiles,
  rowState,
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

/** What the list shares with every chapter and row. */
interface ListContext {
  sets: SinceSets
  threadCounts: Record<string, number>
  currentFilePath: string | null
  onSelectFile: Props['onSelectFile']
}

interface ChapterHeaderProps {
  chapter: Chapter
  num: number
  isOpen: boolean
  progress: string
  onToggle: () => void
}

function ChapterHeader(props: ChapterHeaderProps) {
  return (
    <button
      aria-expanded={props.isOpen}
      className="file-tree-chapter-header"
      onClick={props.onToggle}
    >
      <b>
        {props.num} · {props.chapter.name}
      </b>
      <span>{props.progress}</span>
    </button>
  )
}

function FullFileRow(props: { file: PrChangedFile; chapterId: string; ctx: ListContext }) {
  const { file, ctx } = props
  const isActive = file.path === ctx.currentFilePath
  const isViewed = ctx.sets.viewedFiles.has(file.path)
  const className = classNames('full-file-row file-tree-row', {
    'full-file-row--active': isActive,
    'full-file-row--viewed': isViewed,
  })
  return (
    <button
      aria-current={currentAttr(isActive)}
      className={className}
      onClick={() => ctx.onSelectFile(file.path, props.chapterId)}
      title={file.path}
    >
      <FileRowContent
        file={file}
        state={rowState(file, ctx.sets)}
        isViewed={isViewed}
        threadCount={ctx.threadCounts[file.path] ?? 0}
      />
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
  const viewedInChapter = files.filter((f) => ctx.sets.viewedFiles.has(f.path)).length
  return (
    <div className="file-tree-chapter">
      {headers.show && (
        <ChapterHeader
          chapter={chapter}
          num={props.num}
          isOpen={headers.isOpen}
          progress={`${viewedInChapter} of ${files.length}`}
          onToggle={headers.onToggle}
        />
      )}
      {(!headers.show || headers.isOpen) &&
        files.map((file) => (
          <FullFileRow key={file.path} file={file} chapterId={chapter.id} ctx={ctx} />
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
  const {
    viewedFiles,
    fileOrderOverrides,
    threads = {},
    changedSince = new Set<string>(),
    newSinceLook = new Set<string>(),
  } = usePrReviewStore()
  const threadCounts = Object.fromEntries(
    Object.entries(threads).map(([path, list]) => [path, list.length])
  )
  const ctx: ListContext = {
    sets: { viewedFiles, changedSince, newSinceLook },
    threadCounts,
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
    <div className="full-file-list file-tree">
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
