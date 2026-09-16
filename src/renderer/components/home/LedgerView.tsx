import React from 'react'
import { GitBranch, SquareArrowOutUpRight } from 'lucide-react'
import { StateIcon } from '../session/StateIcon'
import { LivePreview } from '../session/LivePreview'
import { WorkItemCell } from '../session/WorkItemCell'
import { ResumeButton } from '../session/ResumeButton'
import { CloseSessionButton } from '../session/CloseSessionButton'
import { useIssue } from '../session/useSessionFacts'
import { formatRelativeTime } from '../../sidebar/relative-time'
import type { LedgerColumns } from '../../sidebar/home-prefs'
import type { LedgerGroup } from '../../sidebar/ledger-rows'
import type { SessionFacts } from '../../sidebar/session-facts'
import './LedgerView.css'

interface Props {
  groups: LedgerGroup[]
  columns: LedgerColumns
  previewSelected: boolean
  selectedId: string | null
  now: number
  onSelect: (sessionId: string) => void
  onOpen: (sessionId: string) => void
  onSaveDescription: (facts: SessionFacts, description: string | null) => void
  onLink?: (facts: SessionFacts) => void
  onResume?: (facts: SessionFacts) => void
  onCloseSession?: (facts: SessionFacts) => void
  onForgetSession?: (facts: SessionFacts) => void
  /** Drawn inside the selected row's preview, beside Open: answers to a waiting prompt. */
  renderAnswers?: (facts: SessionFacts) => React.ReactNode
}

/**
 * One track per visible column, so a hidden column gives its width to the rest.
 *
 * Every flexible track may shrink to nothing and let its text truncate. Minimum
 * widths that added up to more than the window pushed the last column — the age
 * — off the right edge and made the whole list scroll sideways.
 */
function template(columns: LedgerColumns): string {
  return [
    '24px',
    'minmax(72px, 0.9fr)',
    columns.branch && 'minmax(0, 1.1fr)',
    columns.workItem && 'minmax(0, 1.8fr)',
    columns.tags && 'minmax(0, 0.7fr)',
    columns.latestLine && 'minmax(0, 1.3fr)',
    columns.age && '44px',
    // The close control's own track, last on the line.
    '24px',
  ]
    .filter(Boolean)
    .join(' ')
}

function Row({
  facts,
  columns,
  selected,
  now,
  onSelect,
  onOpen,
  onSaveDescription,
  onLink,
  onResume,
  onCloseSession,
  onForgetSession,
}: {
  facts: SessionFacts
  columns: LedgerColumns
  selected: boolean
  now: number
  onSelect: Props['onSelect']
  onOpen: Props['onOpen']
  onSaveDescription: Props['onSaveDescription']
  onLink?: Props['onLink']
  onResume?: Props['onResume']
  onCloseSession?: Props['onCloseSession']
  onForgetSession?: Props['onForgetSession']
}): JSX.Element {
  const issue = useIssue(facts.workItem?.ref)
  return (
    <div
      role="row"
      aria-label={facts.name}
      aria-selected={selected}
      tabIndex={0}
      className={`ledger__row${selected ? ' ledger__row--selected' : ''}`}
      style={facts.workspaceColor ? { ['--rail' as string]: facts.workspaceColor } : undefined}
      onClick={() => onSelect(facts.sessionId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !facts.isClosed) onOpen(facts.sessionId)
        if (e.key === ' ') {
          e.preventDefault()
          onSelect(facts.sessionId)
        }
      }}
    >
      <span role="gridcell" className="ledger__state">
        <StateIcon state={facts.state} />
      </span>
      <span role="gridcell" className="ledger__name">
        {facts.name}
      </span>
      {columns.branch && (
        <span role="gridcell" className="ledger__branch">
          {facts.branch !== null && (
            <>
              <GitBranch aria-hidden="true" />
              <span>{facts.branch}</span>
            </>
          )}
        </span>
      )}
      {columns.workItem && (
        <span role="gridcell" className="ledger__work">
          <WorkItemCell
            workItem={facts.workItem}
            issue={issue}
            description={facts.description}
            readOnly={facts.isClosed}
            onSaveDescription={(text) => onSaveDescription(facts, text)}
            onLink={onLink && !facts.isClosed ? () => onLink(facts) : undefined}
          />
          {onResume && <ResumeButton facts={facts} onResume={onResume} />}
        </span>
      )}
      {columns.tags && (
        <span role="gridcell" className="ledger__tags">
          {facts.tags.map((tag) => (
            <span key={tag} className="ledger__tag">
              {tag}
            </span>
          ))}
        </span>
      )}
      {columns.latestLine && (
        <span role="gridcell" className="ledger__latest">
          {facts.choicePrompt?.question ?? facts.latestLine}
        </span>
      )}
      {columns.age && (
        <span role="gridcell" className="ledger__age">
          {formatRelativeTime(facts.lastActivityAt, now)}
        </span>
      )}
      {onCloseSession && (
        <CloseSessionButton facts={facts} onClose={onCloseSession} onForget={onForgetSession} />
      )}
    </div>
  )
}

/** Every session as one line, grouped where it lives. */
export function LedgerView({
  groups,
  columns,
  previewSelected,
  selectedId,
  now,
  onSelect,
  onOpen,
  onSaveDescription,
  onLink,
  onResume,
  onCloseSession,
  onForgetSession,
  renderAnswers,
}: Props): JSX.Element {
  return (
    <div
      role="grid"
      aria-label="Sessions"
      className="ledger"
      style={{ ['--ledger-columns' as string]: template(columns) }}
    >
      <div role="row" className="ledger__head">
        <span role="columnheader" />
        <span role="columnheader">Session</span>
        {columns.branch && <span role="columnheader">Branch</span>}
        {columns.workItem && <span role="columnheader">Work item or description</span>}
        {columns.tags && <span role="columnheader">Tags</span>}
        {columns.latestLine && <span role="columnheader">Latest output</span>}
        {columns.age && (
          <span role="columnheader" className="ledger__age">
            Age
          </span>
        )}
        <span role="columnheader" />
      </div>

      {groups.map((group) => (
        <div key={group.key} role="rowgroup" aria-label={group.label} className="ledger__group">
          <div className="ledger__group-label" aria-hidden="true">
            {group.label}
            <span className="ledger__group-count">{group.facts.length}</span>
          </div>
          {group.facts.map((facts) => {
            const selected = facts.sessionId === selectedId
            return (
              <React.Fragment key={facts.sessionId}>
                <Row
                  facts={facts}
                  columns={columns}
                  selected={selected}
                  now={now}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onSaveDescription={onSaveDescription}
                  onLink={onLink}
                  onResume={onResume}
                  onCloseSession={onCloseSession}
                  onForgetSession={onForgetSession}
                />
                {selected && previewSelected && !facts.isClosed && (
                  <div role="row" className="ledger__expand">
                    <div
                      role="region"
                      aria-label={`Preview of ${facts.name}`}
                      className="ledger__expand-inner"
                    >
                      <LivePreview sessionId={facts.sessionId} className="ledger__preview" />
                      <div className="ledger__actions">
                        {renderAnswers?.(facts)}
                        <button
                          type="button"
                          className="ledger__open"
                          aria-label={`Open ${facts.name}`}
                          onClick={() => onOpen(facts.sessionId)}
                        >
                          <SquareArrowOutUpRight aria-hidden="true" />
                          Open terminal
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      ))}
    </div>
  )
}
