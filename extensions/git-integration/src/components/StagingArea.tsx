import React, { useCallback } from 'react'
import { Button } from '@terminator/extension-ui'
import { useGitStore } from '../stores/git.store'
import type { GitFileStatus, GitStatus } from '../schemas/git.schema'
import { gitAPI } from '../api/git'
import { recordUsage } from '@terminator/extension-sdk/renderer'

/**
 * File status, in words.
 *
 * These were git's porcelain letters — M, A, D, R, U and a bare `?` for an
 * untracked file. That is the plumbing's notation surfacing into the interface:
 * the panel knows the file is new and was showing a punctuation mark instead of
 * saying so.
 */
const STATUS_BADGE: Record<string, string> = {
  modified: 'Changed',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New',
  conflicted: 'Conflict',
}

const STATUS_LABEL: Record<string, string> = {
  modified: 'Changed since the last commit',
  added: 'Staged as a new file',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New — not tracked by git yet',
  conflicted: 'Conflicted — needs resolving before it can be committed',
}

interface StagingAreaProps {
  repoRoot: string
  onFileSelect: (path: string, staged: boolean) => void
  onStagingChange?: () => void
}

interface FileItemProps {
  file: GitFileStatus
  isSelected: boolean
  onToggle: (path: string, currentlyStaged: boolean) => Promise<void>
  onSelect: (path: string, staged: boolean) => void
}

type StatusAnswer = GitStatus | { error: string }

const CONFLICT_HINT = 'Resolve conflicts before staging'

function FileItem(props: FileItemProps): JSX.Element {
  const { file, onToggle } = props
  const isConflicted = file.status === 'conflicted'
  const selected = (props.isSelected && ' staging-area__file-row--selected') || ''
  return (
    <div
      className={`staging-area__file-row${selected}`}
      onClick={() => props.onSelect(file.path, file.staged)}
    >
      <input
        type="checkbox"
        className="staging-area__checkbox"
        checked={file.staged}
        disabled={isConflicted}
        title={(isConflicted && CONFLICT_HINT) || undefined}
        onChange={() => void onToggle(file.path, file.staged)}
        onClick={(e) => e.stopPropagation()}
      />
      <span
        className={`staging-area__badge staging-area__badge--${file.status}`}
        title={STATUS_LABEL[file.status] ?? file.status}
      >
        {STATUS_BADGE[file.status] ?? 'Changed'}
      </span>
      <span className="staging-area__file-path">{file.path}</span>
      {isConflicted && <span className="staging-area__conflict-badge">!</span>}
    </div>
  )
}

async function refreshStatus(
  repoRoot: string,
  setStatus: (s: GitStatus | null) => void
): Promise<void> {
  try {
    const result = (await gitAPI.status(repoRoot)) as StatusAnswer
    if ('error' in result) setStatus(null)
    else setStatus(result)
  } catch {
    // silently ignore — next polling cycle will pick it up
  }
}

interface StagingTarget {
  repoRoot: string
  setStatus: (s: GitStatus | null) => void
  onStagingChange: (() => void) | undefined
}

/** Stage or unstage paths, then let the view drop its cached diffs and refresh the status. */
async function applyStaging(target: StagingTarget, paths: string[], stage: boolean): Promise<void> {
  if (paths.length === 0) return
  if (stage) {
    await gitAPI.stage(target.repoRoot, paths)
    recordUsage('stage')
  } else await gitAPI.unstage(target.repoRoot, paths)
  // Bust the diff cache so the next click on a file fetches a fresh diff.
  target.onStagingChange?.()
  await refreshStatus(target.repoRoot, target.setStatus)
}

function useStaging(repoRoot: string, onStagingChange: StagingTarget['onStagingChange']) {
  const setStatus = useGitStore((s) => s.setStatus)
  return useCallback(
    (paths: string[], stage: boolean) =>
      applyStaging({ repoRoot, setStatus, onStagingChange }, paths, stage),
    [repoRoot, setStatus, onStagingChange]
  )
}

/** What every row in a section shares: the selected file and the row handlers. */
interface SectionItem extends Omit<FileItemProps, 'file' | 'isSelected'> {
  selectedFile: string | null
}

interface SectionText {
  title: string
  emptyText: string
  bulkLabel: string
}

const STAGED_TEXT: SectionText = {
  title: 'Staged',
  emptyText: 'No staged changes',
  bulkLabel: 'Unstage All',
}

const CHANGES_TEXT: SectionText = {
  title: 'Changes',
  emptyText: 'No unstaged changes',
  bulkLabel: 'Stage All',
}

interface FileSectionProps {
  text: SectionText
  files: GitFileStatus[]
  onBulk: () => void
  item: SectionItem
}

function StagingFileSection(props: FileSectionProps) {
  const { files, item, text } = props
  return (
    <div className="staging-area__section">
      <div className="staging-area__section-header">
        <span>
          {text.title} ({files.length})
        </span>
        {files.length > 0 && (
          <Button variant="ghost" size="sm" onClick={props.onBulk}>
            {text.bulkLabel}
          </Button>
        )}
      </div>
      {files.map((f) => (
        <FileItem
          key={f.path}
          file={f}
          isSelected={f.path === item.selectedFile}
          onToggle={item.onToggle}
          onSelect={item.onSelect}
        />
      ))}
      {files.length === 0 && <div className="staging-area__empty">{text.emptyText}</div>}
    </div>
  )
}

function StagingLoading() {
  return (
    <div className="staging-area">
      <div className="staging-area__empty">Loading…</div>
    </div>
  )
}

interface StagingSectionsProps {
  files: GitFileStatus[]
  setStaged: (paths: string[], stage: boolean) => Promise<void>
  item: SectionItem
}

function StagingSections({ files, setStaged, item }: StagingSectionsProps): JSX.Element {
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)
  const stageable = unstaged.filter((f) => f.status !== 'conflicted').map((f) => f.path)
  const unstageAll = () =>
    void setStaged(
      staged.map((f) => f.path),
      false
    )
  return (
    <>
      <StagingFileSection text={STAGED_TEXT} files={staged} onBulk={unstageAll} item={item} />
      <StagingFileSection
        text={CHANGES_TEXT}
        files={unstaged}
        onBulk={() => void setStaged(stageable, true)}
        item={item}
      />
    </>
  )
}

export function StagingArea(props: StagingAreaProps): JSX.Element {
  const status = useGitStore((s) => s.status)
  const selectedFile = useGitStore((s) => s.selectedFile)
  const setStaged = useStaging(props.repoRoot, props.onStagingChange)
  // A failed toggle surfaces through the next status poll.
  const toggleFile = useCallback(
    (path: string, staged: boolean) => setStaged([path], !staged).catch(() => {}),
    [setStaged]
  )
  if (!status) return <StagingLoading />
  const item = { selectedFile, onToggle: toggleFile, onSelect: props.onFileSelect }
  return (
    <div className="staging-area">
      {status.truncated && (
        <div className="staging-area__truncation-banner">
          Showing first {status.files.length} files.
        </div>
      )}
      <StagingSections files={status.files} setStaged={setStaged} item={item} />
    </div>
  )
}
