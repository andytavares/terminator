import React, { useState } from 'react'
import { Tabs } from '@terminator/extension-ui'
import { PrReviewTab } from '../pr-review/PrReviewTab'
import { WorktreesView } from './WorktreesView'

type GitTab = 'reviews' | 'worktrees'

/** The workspace's Git tab: the review queue, and the local worktrees and branches. */
export function WorkspaceGitView(props: { repoRoot: string | null }): React.JSX.Element {
  const [tab, setTab] = useState<GitTab>('reviews')
  return (
    <Tabs
      label="Git sections"
      selectedId={tab}
      onSelect={(id) => setTab(id as GitTab)}
      tabs={[
        { id: 'reviews', label: 'Reviews', panel: <PrReviewTab repoRoot={props.repoRoot} /> },
        { id: 'worktrees', label: 'Worktrees', panel: <WorktreesView repoRoot={props.repoRoot} /> },
      ]}
    />
  )
}
