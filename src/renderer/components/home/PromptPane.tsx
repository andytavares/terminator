import React from 'react'
import { ScheduledRuns, WhenChoices, type WhenValue } from './WhenChoices'

interface PromptPaneProps {
  query: string
  onType: (text: string) => void
  when: WhenValue
  onWhen: (value: WhenValue) => void
}

/** The Prompt tab: the task in a box that grows lines, when to run it, and what is already saved. */
export function PromptPane({ query, onType, when, onWhen }: PromptPaneProps): React.JSX.Element {
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
      {when.when !== 'now' && <ScheduledRuns />}
    </div>
  )
}
