import React, { useCallback } from 'react'
import { useGitStore } from '../stores/git.store'
import type { GitFileStatus, GitStatus } from '../schemas/git.schema'

const STATUS_BADGE: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflicted: 'U',
}

interface StagingAreaProps {
  repoRoot: string
  onFileSelect: (path: string, staged: boolean) => void
}

function FileItem({
  file,
  isSelected,
  onToggle,
  onSelect,
}: {
  file: GitFileStatus
  isSelected: boolean
  onToggle: (path: string, currentlyStaged: boolean) => Promise<void>
  onSelect: (path: string, staged: boolean) => void
}): JSX.Element {
  const isConflicted = file.status === 'conflicted'
  const badge = STATUS_BADGE[file.status] ?? '~'

  return (
    <div
      className={`staging-area__file-row${isSelected ? ' staging-area__file-row--selected' : ''}`}
      onClick={() => onSelect(file.path, file.staged)}
    >
      <input
        type="checkbox"
        className="staging-area__checkbox"
        checked={file.staged}
        disabled={isConflicted}
        title={isConflicted ? 'Resolve conflicts before staging' : undefined}
        onChange={() => void onToggle(file.path, file.staged)}
        onClick={(e) => e.stopPropagation()}
      />
      <span
        className={`staging-area__badge staging-area__badge--${file.status}`}
        title={file.status}
      >
        {badge}
      </span>
      <span className="staging-area__file-path">{file.path}</span>
      {isConflicted && <span className="staging-area__conflict-badge">!</span>}
    </div>
  )
}

async function refreshStatus(repoRoot: string, setStatus: (s: GitStatus | null) => void): Promise<void> {
  try {
    const result = await window.electronAPI.git.status(repoRoot) as GitStatus | { error: string }
    if ('error' in result) setStatus(null)
    else setStatus(result as unknown as GitStatus)
  } catch {
    // silently ignore — next polling cycle will pick it up
  }
}

export function StagingArea({ repoRoot, onFileSelect }: StagingAreaProps): JSX.Element {
  const { status, setStatus, selectedFile } = useGitStore()

  const toggleFile = useCallback(
    async (filePath: string, currentlyStaged: boolean) => {
      try {
        if (currentlyStaged) {
          await window.electronAPI.git.unstage(repoRoot, [filePath])
        } else {
          await window.electronAPI.git.stage(repoRoot, [filePath])
        }
        await refreshStatus(repoRoot, setStatus)
      } catch {
        // errors surface via next status poll
      }
    },
    [repoRoot, setStatus]
  )

  const stageAll = useCallback(async () => {
    const unstaged = status?.files.filter((f) => !f.staged && f.status !== 'conflicted') ?? []
    if (unstaged.length === 0) return
    await window.electronAPI.git.stage(repoRoot, unstaged.map((f) => f.path))
    await refreshStatus(repoRoot, setStatus)
  }, [repoRoot, status, setStatus])

  const unstageAll = useCallback(async () => {
    const staged = status?.files.filter((f) => f.staged) ?? []
    if (staged.length === 0) return
    await window.electronAPI.git.unstage(repoRoot, staged.map((f) => f.path))
    await refreshStatus(repoRoot, setStatus)
  }, [repoRoot, status, setStatus])

  if (!status) {
    return (
      <div className="staging-area">
        <div className="staging-area__empty">Loading…</div>
      </div>
    )
  }

  const stagedFiles = status.files.filter((f) => f.staged)
  const unstagedFiles = status.files.filter((f) => !f.staged)

  return (
    <div className="staging-area">
      {status.truncated && (
        <div className="staging-area__truncation-banner">
          Showing first 500 files.
        </div>
      )}

      <div className="staging-area__section">
        <div className="staging-area__section-header">
          <span>Staged ({stagedFiles.length})</span>
          {stagedFiles.length > 0 && (
            <button className="staging-area__action-btn" onClick={() => void unstageAll()}>
              Unstage All
            </button>
          )}
        </div>
        {stagedFiles.map((f) => (
          <FileItem key={f.path} file={f} isSelected={f.path === selectedFile} onToggle={toggleFile} onSelect={onFileSelect} />
        ))}
        {stagedFiles.length === 0 && (
          <div className="staging-area__empty">No staged changes</div>
        )}
      </div>

      <div className="staging-area__section">
        <div className="staging-area__section-header">
          <span>Changes ({unstagedFiles.length})</span>
          {unstagedFiles.length > 0 && (
            <button className="staging-area__action-btn" onClick={() => void stageAll()}>
              Stage All
            </button>
          )}
        </div>
        {unstagedFiles.map((f) => (
          <FileItem key={f.path} file={f} isSelected={f.path === selectedFile} onToggle={toggleFile} onSelect={onFileSelect} />
        ))}
        {unstagedFiles.length === 0 && (
          <div className="staging-area__empty">No unstaged changes</div>
        )}
      </div>
    </div>
  )
}
