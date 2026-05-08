import React, { useCallback } from 'react'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { StagingArea } from './StagingArea'
import './git-integration.css'
import type { FileDiff } from '../../../../src/shared/schemas/git.schema'

interface Props {
  repoRoot: string | null
  onClose: () => void
}

export function GitSidebarPanel({ repoRoot, onClose }: Props): JSX.Element {
  useGitStatus(repoRoot)
  const { status, setSelectedFile, setDiff } = useGitStore()
  const { setActiveProjectTab } = useExtensionRegistry()

  const handleFileSelect = useCallback((path: string, staged: boolean) => {
    setSelectedFile(path)
    setActiveProjectTab('git')
    if (repoRoot) {
      void window.electronAPI.git.diffFile(repoRoot, path, staged).then((result) => {
        const r = result as { diff: FileDiff } | { error: string }
        if ('diff' in r) setDiff(path, r.diff)
      })
    }
  }, [repoRoot, setSelectedFile, setActiveProjectTab, setDiff])

  return (
    <div className="git-sidebar">
      <div className="git-sidebar__header">
        {status ? (
          <span className="git-sidebar__branch">⎇ {status.branch}</span>
        ) : (
          <span className="git-sidebar__branch">Git</span>
        )}
        <button className="git-sidebar__close-btn" onClick={onClose} title="Close">×</button>
      </div>

      {!status ? (
        <div className="git-sidebar__loading">Loading…</div>
      ) : (
        <StagingArea repoRoot={repoRoot!} onFileSelect={handleFileSelect} />
      )}
    </div>
  )
}
