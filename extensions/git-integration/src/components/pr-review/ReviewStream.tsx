import React, { useEffect, useRef, useState } from 'react'
import type { Chapter, PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
import type { HunkProgress } from '../../review/review-layout'
import { ReviewDiffPane } from './ReviewDiffPane'
import { ESTIMATED_ITEM_PX } from './VirtualDiffList'
import './review-stream.css'

/** A file of the review, tagged with its chapter. */
export interface FileEntry {
  chapterId: string
  path: string
}

/** A chapter as the stream shows it: its files in reading order and its read hunks. */
export interface StreamChapter {
  chapter: Chapter
  files: PrChangedFile[]
  progress: HunkProgress
}

type ScrollRef = React.RefObject<HTMLDivElement | null>

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  chapters: StreamChapter[]
  showChapterHeaders: boolean
  activePath: string | null
  /** The file to scroll to; a new object scrolls again. */
  scrollTarget: { path: string } | null
  scrollRef: ScrollRef
  onActivate: (entry: FileEntry) => void
  onPrevFile: () => void
  onNextFile: () => void
  /** Shown after the last file, such as the chapter's Done button. */
  end?: React.ReactNode
}

/** The file header's height, added to a placeholder so the scrollbar is close before a file
 *  mounts. */
const FILE_HEADER_PX = 64
/** How far past the viewport a file section mounts and starts fetching its diff. */
const MOUNT_MARGIN = '800px 0px'
/** The sticky chapter header covers this much of the top of the stream. */
const STICKY_HEADER_PX = 40

function placeholderHeight(file: PrChangedFile): number {
  return FILE_HEADER_PX + (file.additions + file.deletions) * ESTIMATED_ITEM_PX
}

/** True once the element comes near the viewport of `scrollRef`; it then stays true. Without
 *  IntersectionObserver (jsdom) every section mounts at once. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, scrollRef: ScrollRef) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { root: scrollRef.current, rootMargin: MOUNT_MARGIN }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, ref, scrollRef])
  return near
}

function sections(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>('[data-review-path]')]
}

/** The file section at the top of the viewport, under the sticky chapter header. */
function sectionAtTop(scroller: HTMLElement): HTMLElement | undefined {
  const top = scroller.getBoundingClientRect().top + STICKY_HEADER_PX
  return sections(scroller).find((s) => s.getBoundingClientRect().bottom > top)
}

/** Makes the file section at the top of the viewport the active one as the reader scrolls. */
function useActiveSection(scrollRef: ScrollRef, onActivate: Props['onActivate']) {
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const handleScroll = () => {
      const section = sectionAtTop(scroller)
      if (!section) return
      const { reviewPath, reviewChapter } = section.dataset
      onActivate({ path: reviewPath!, chapterId: reviewChapter! })
    }
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [scrollRef, onActivate])
}

function useScrollToTarget(scrollRef: ScrollRef, target: Props['scrollTarget']) {
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !target) return
    const section = sections(scroller).find((s) => s.dataset.reviewPath === target.path)
    section?.scrollIntoView?.({ block: 'start' })
  }, [scrollRef, target])
}

/** What every file section needs from the stream, apart from its scroll element. */
type SectionContext = Pick<Props, 'repoRoot' | 'pr' | 'activePath' | 'onPrevFile' | 'onNextFile'>

interface SectionProps {
  context: SectionContext
  scrollRef: ScrollRef
  file: PrChangedFile
  chapterId: string
}

/** One file of the stream: a placeholder of about its height until it nears the viewport. */
function FileSection({ context, scrollRef, file, chapterId }: SectionProps) {
  const ref = useRef<HTMLElement>(null)
  const near = useNearViewport(ref, scrollRef)
  return (
    <section
      ref={ref}
      className="rs-file"
      data-review-path={file.path}
      data-review-chapter={chapterId}
    >
      {near && (
        <ReviewDiffPane
          repoRoot={context.repoRoot}
          pr={context.pr}
          file={file}
          scrollRef={scrollRef}
          active={file.path === context.activePath}
          onPrevFile={context.onPrevFile}
          onNextFile={context.onNextFile}
        />
      )}
      {!near && <div className="rs-placeholder" style={{ height: placeholderHeight(file) }} />}
    </section>
  )
}

function ChapterHeader({ chapter, progress }: StreamChapter) {
  return (
    <h2 className="rs-chapter-head">
      <span className="rs-chapter-name">{chapter.name}</span>
      <span className="rs-chapter-progress">
        {progress.read} of {progress.total} hunks read
      </span>
    </h2>
  )
}

interface GroupProps {
  context: SectionContext
  scrollRef: ScrollRef
  group: StreamChapter
  showHeader: boolean
}

function ChapterGroup({ context, scrollRef, group, showHeader }: GroupProps) {
  return (
    <div className="rs-chapter">
      {showHeader && <ChapterHeader {...group} />}
      {group.files.map((file) => (
        <FileSection
          key={file.path}
          context={context}
          scrollRef={scrollRef}
          file={file}
          chapterId={group.chapter.id}
        />
      ))}
    </div>
  )
}

/** The review's files one after another in one scroll element, grouped by chapter. */
export function ReviewStream(props: Props) {
  const { scrollRef, chapters, showChapterHeaders, end } = props
  const { repoRoot, pr, activePath, onPrevFile, onNextFile } = props
  const context = { repoRoot, pr, activePath, onPrevFile, onNextFile }
  useActiveSection(scrollRef, props.onActivate)
  useScrollToTarget(scrollRef, props.scrollTarget)
  return (
    <div className="review-diff-scroll rs-scroll" data-testid="review-stream" ref={scrollRef}>
      <div className="rs-content">
        {chapters.map((group) => (
          <ChapterGroup
            key={group.chapter.id}
            context={context}
            scrollRef={scrollRef}
            group={group}
            showHeader={showChapterHeaders}
          />
        ))}
        {end && <div className="rs-end">{end}</div>}
      </div>
    </div>
  )
}
