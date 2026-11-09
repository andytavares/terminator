import React, { Suspense, lazy, useEffect, useState } from 'react'

// A page shows one view, so each is its own chunk and the first script stays
// under the renderer's chunk budget (vite.renderer.config.mts;
// https://react.dev/reference/react/lazy, https://vite.dev/guide/features#dynamic-import).
const GitFullView = lazy(() =>
  import('../components/GitFullView').then((m) => ({ default: m.GitFullView }))
)
const PrReviewTab = lazy(() =>
  import('../components/pr-review/PrReviewTab').then((m) => ({ default: m.PrReviewTab }))
)
const WorkspaceGitView = lazy(() =>
  import('../components/worktrees/WorkspaceGitView').then((m) => ({ default: m.WorkspaceGitView }))
)
const ReviewDashboard = lazy(() =>
  import('../components/pr-review/ReviewDashboard').then((m) => ({ default: m.ReviewDashboard }))
)
const ContributionsOnHome = lazy(() =>
  import('../components/contributions/ContributionsOnHome').then((m) => ({
    default: m.ContributionsOnHome,
  }))
)

function getSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

export function App(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <ViewForPage />
    </Suspense>
  )
}

/** The repository its URL names, for the view's life. A view opened without one follows the
 *  workspace; the main window reloads its frame with a new URL when its repository changes. */
function useRepoRoot(): string | null {
  const [urlRepoRoot] = useState(() => getSearchParam('repoRoot') || null)
  const [workspaceRepoRoot, setWorkspaceRepoRoot] = useState<string | null>(null)

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setWorkspaceRepoRoot(d.repoRoot ?? null)
    })
    return off
  }, [])

  return urlRepoRoot ?? workspaceRepoRoot
}

function ViewForPage(): React.JSX.Element {
  const view = getSearchParam('view')
  const repoRoot = useRepoRoot()

  if (view === 'reviews') {
    return <ReviewDashboard />
  }
  if (view === 'home') {
    return <ContributionsOnHome />
  }
  if (view === 'code-reviews') {
    return <WorkspaceGitView repoRoot={repoRoot} />
  }
  if (view === 'pr-review') {
    return <PrReviewTab repoRoot={repoRoot} />
  }
  return <GitFullView repoRoot={repoRoot} />
}
