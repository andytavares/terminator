import React, { useCallback } from 'react'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { StagingArea } from './StagingArea'
import './git-integration.css'
import type { FileDiff } from '../schemas/git.schema'
import { gitAPI } from '../api/git'

interface Props {
  repoRoot: string | null
  onClose: () => void
}

export function GitSidebarPanel({ repoRoot, onClose }: Props): JSX.Element {
  useGitStatus(repoRoot)
  const { status, setSelectedFile, setDiff, setView } = useGitStore()
  const { setActiveProjectTab } = useExtensionRegistry()

  const handleFileSelect = useCallback(
    (path: string, staged: boolean) => {
      setSelectedFile(path)
      setActiveProjectTab('git')
      if (repoRoot) {
        void gitAPI.diffFile(repoRoot, path, staged).then((result) => {
          const r = result as { diff: FileDiff } | { error: string }
          if ('diff' in r) setDiff(path, r.diff)
        })
      }
    },
    [repoRoot, setSelectedFile, setActiveProjectTab, setDiff]
  )

  return (
    <div className="git-sidebar">
      <div className="git-sidebar__header">
        {status ? (
          <span className="git-sidebar__branch">⎇ {status.branch}</span>
        ) : (
          <span className="git-sidebar__branch">Git</span>
        )}
        <button className="git-sidebar__close-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {status?.hasConflicts && (
        <button
          className="git-sidebar__resolve-conflicts-btn"
          onClick={() => setView('merge-flow')}
          data-testid="resolve-conflicts-btn"
        >
          Resolve conflicts →
        </button>
      )}

      {!status ? (
        <div className="git-sidebar__file-list">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton skeleton--row" />
          ))}
        </div>
      ) : (
        <StagingArea repoRoot={repoRoot!} onFileSelect={handleFileSelect} />
      )}
    </div>
  )
}
