import React from 'react'
import { Button } from '@terminator/extension-ui'
import { WhenChoices, type WhenValue } from './WhenChoices'
import { scheduledRunCount, useSavedRuns } from './scheduled-runs'
import { useStartWorkStore } from './start-work'
import { useHomeView } from './home-view'
import { useExtensionRegistry } from '../../extensions/registry'

interface PromptPaneProps {
  query: string
  onType: (text: string) => void
  when: WhenValue
  onWhen: (value: WhenValue) => void
}

/** The Prompt tab: the task in a box that grows lines, when to run it, and how many are saved. */
export function PromptPane({ query, onType, when, onWhen }: PromptPaneProps): React.JSX.Element {
  const editing = useStartWorkStore((s) => s.editing !== null)
  return (
    <div className="start-work__list start-work__prompt">
      <div className="start-work__label">What should it do?</div>
      <textarea
        autoFocus
        rows={5}
        value={query}
        aria-label="What should it do?"
        placeholder="Describe the task"
        onChange={(e) => onType(e.target.value)}
      />
      <p className="start-work__hint">↵ start · ⇧↵ new line</p>
      <WhenChoices value={when} onChange={onWhen} />
      {when.when !== 'now' && !editing && <SavedCount />}
    </div>
  )
}

function manageOnHome(): void {
  useStartWorkStore.getState().closeLauncher()
  useHomeView.getState().show('scheduled')
  useExtensionRegistry.getState().setActiveGlobalTab('core.home')
}

/** "2 scheduled runs · Manage on Home"; nothing when none is saved. */
function SavedCount(): React.JSX.Element | null {
  const count = useSavedRuns().runs?.length ?? 0
  if (count === 0) return null
  return (
    <p className="start-work__note">
      {scheduledRunCount(count)} ·{' '}
      <Button variant="ghost" size="sm" onClick={manageOnHome}>
        Manage on Home
      </Button>
    </p>
  )
}
