import React from 'react'
import { GitBranch, SquareArrowOutUpRight } from 'lucide-react'
import { StateChip } from '../session/StateChip'
import { LivePreview } from '../session/LivePreview'
import { WorkItemCell } from '../session/WorkItemCell'
import { ResumeButton } from '../session/ResumeButton'
import { CloseSessionButton } from '../session/CloseSessionButton'
import { useIssue } from '../session/useSessionFacts'
import { formatRelativeTime } from '../../sidebar/relative-time'
import type { LedgerColumns } from '../../sidebar/home-prefs'
import type { LedgerGroup } from '../../sidebar/ledger-rows'
import type { SessionActions, SessionFacts } from '../../sidebar/session-facts'
import '../screen-chrome.css'
import './LedgerView.css'

interface Props extends SessionActions {
  groups: LedgerGroup[]
  columns: LedgerColumns
  previewSelected: boolean
  selectedId: string | null
  now: number
  onSelect: (sessionId: string) => void
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
    // Fixed, and wide enough for the longest label, "Waiting on you": a track
    // that grows with the window leaves every chip floating a different
    // distance from the name beside it.
    '124px',
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

interface RowProps extends SessionActions {
  facts: SessionFacts
  columns: LedgerColumns
  selected: boolean
  now: number
  onSelect: Props['onSelect']
}

/** One session on one line: Enter opens it, Space selects it. */
function Row(props: RowProps): JSX.Element {
  const { facts, selected, onSelect, onOpen, onCloseSession, onForgetSession } = props
  return (
    <div
      role="row"
      aria-label={facts.name}
      aria-selected={selected}
      tabIndex={0}
      className={`ledger__row${selected ? ' ledger__row--selected' : ''}${
        facts.state === 'awaiting-input' ? ' ledger__row--needs' : ''
      }`}
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
      <RowCells {...props} />
      {onCloseSession && (
        <CloseSessionButton facts={facts} onClose={onCloseSession} onForget={onForgetSession} />
      )}
    </div>
  )
}

/** State and name, then each column the operator has turned on. */
function RowCells({ facts, columns, now, ...actions }: RowProps): JSX.Element {
  return (
    <>
      <span role="gridcell" className="ledger__state">
        <StateChip state={facts.state} />
      </span>
      <span role="gridcell" className="ledger__name">
        {facts.name}
      </span>
      {columns.branch && <BranchCell branch={facts.branch} />}
      {columns.workItem && <WorkCell facts={facts} {...actions} />}
      {columns.tags && <TagsCell tags={facts.tags} />}
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
    </>
  )
}

function TagsCell({ tags }: { tags: string[] }): JSX.Element {
  return (
    <span role="gridcell" className="ledger__tags">
      {tags.map((tag) => (
        <span key={tag} className="ledger__tag">
          {tag}
        </span>
      ))}
    </span>
  )
}

function BranchCell({ branch }: { branch: string | null }): JSX.Element {
  return (
    <span role="gridcell" className="ledger__branch">
      {branch !== null && (
        <>
          <GitBranch aria-hidden="true" />
          <span>{branch}</span>
        </>
      )}
    </span>
  )
}

/** What the session is for, editable while it runs, and Resume once it stops. */
function WorkCell({
  facts,
  onSaveDescription,
  onLink,
  onResume,
}: SessionActions & { facts: SessionFacts }) {
  const issue = useIssue(facts.workItem?.ref)
  return (
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
  )
}

/** Every session as one line, grouped where it lives. */
export function LedgerView({ groups, columns, ...rest }: Props): JSX.Element {
  return (
    <div
      role="grid"
      aria-label="Sessions"
      className="ledger"
      style={{ ['--ledger-columns' as string]: template(columns) }}
    >
      <LedgerHead columns={columns} />
      {groups.map((group) => (
        <LedgerGroupRows key={group.key} group={group} columns={columns} {...rest} />
      ))}
    </div>
  )
}

function LedgerHead({ columns }: { columns: LedgerColumns }): JSX.Element {
  return (
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
  )
}

type GroupProps = Omit<Props, 'groups'> & { group: LedgerGroup }

/** A group's label (with its repo's swatch, unless it is Needs you) and its rows. */
function LedgerGroupRows({
  group,
  selectedId,
  previewSelected,
  renderAnswers,
  ...row
}: GroupProps) {
  return (
    <div role="rowgroup" aria-label={group.label} className="ledger__group">
      <GroupLabel group={group} />
      {group.facts.map((facts) => {
        const selected = facts.sessionId === selectedId
        return (
          <React.Fragment key={facts.sessionId}>
            <Row facts={facts} selected={selected} {...row} />
            {selected && previewSelected && !facts.isClosed && (
              <RowPreview facts={facts} onOpen={row.onOpen} renderAnswers={renderAnswers} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/** The group's name and count, with its repo's swatch unless it is Needs you. */
function GroupLabel({ group }: { group: LedgerGroup }): JSX.Element {
  const isNeedsYou = group.key === 'needs-you'
  const swatchColor = !isNeedsYou ? (group.facts[0]?.workspaceColor ?? null) : null
  return (
    <div
      className={`ledger__group-label${isNeedsYou ? ' ledger__group-label--needs' : ''}`}
      aria-hidden="true"
    >
      {swatchColor !== null && (
        <span
          className="ledger__group-swatch"
          aria-hidden="true"
          style={{ background: swatchColor }}
        />
      )}
      {group.label}
      <span className="ledger__group-count">{group.facts.length}</span>
    </div>
  )
}

interface PreviewProps {
  facts: SessionFacts
  onOpen: Props['onOpen']
  renderAnswers: Props['renderAnswers']
}

/** The selected row's live terminal, any answers, and Open. */
function RowPreview({ facts, onOpen, renderAnswers }: PreviewProps): JSX.Element {
  return (
    <div role="row" className="ledger__expand">
      <div role="region" aria-label={`Preview of ${facts.name}`} className="ledger__expand-inner">
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
  )
}
