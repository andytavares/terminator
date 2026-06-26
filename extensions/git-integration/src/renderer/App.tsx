import React, { useEffect, useState } from 'react'
import { GitSidebarPanel } from '../components/GitSidebarPanel'
import { GitFullView } from '../components/GitFullView'
import { PrReviewTab } from '../components/pr-review/PrReviewTab'

function getSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

export function App(): JSX.Element {
  const view = getSearchParam('view')
  const [repoRoot, setRepoRoot] = useState<string | null>(getSearchParam('repoRoot') || null)

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
    })
    return off
  }, [])

  if (view === 'project') {
    return <GitFullView repoRoot={repoRoot} />
  }
  if (view === 'code-reviews' || view === 'pr-review') {
    return <PrReviewTab repoRoot={repoRoot} />
  }
  return <GitSidebarPanel repoRoot={repoRoot} onClose={() => {}} />
}
