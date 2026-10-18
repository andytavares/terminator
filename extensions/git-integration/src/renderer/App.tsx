import React, { Suspense, lazy, useEffect, useState } from 'react'

// A page shows one view, so each is its own chunk and the first script stays
// under the renderer's chunk budget (vite.renderer.config.ts;
// https://react.dev/reference/react/lazy, https://vite.dev/guide/features#dynamic-import).
const GitFullView = lazy(() =>
  import('../components/GitFullView').then((m) => ({ default: m.GitFullView }))
)
const PrReviewTab = lazy(() =>
  import('../components/pr-review/PrReviewTab').then((m) => ({ default: m.PrReviewTab }))
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

export function App(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <ViewForPage />
    </Suspense>
  )
}

function ViewForPage(): JSX.Element {
  const view = getSearchParam('view')
  const [repoRoot, setRepoRoot] = useState<string | null>(getSearchParam('repoRoot') || null)

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
    })
    return off
  }, [])

  if (view === 'reviews') {
    return <ReviewDashboard />
  }
  if (view === 'home') {
    return <ContributionsOnHome />
  }
  if (view === 'code-reviews' || view === 'pr-review') {
    return <PrReviewTab repoRoot={repoRoot} />
  }
  return <GitFullView repoRoot={repoRoot} />
}
