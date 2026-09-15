import React, { useEffect, useState } from 'react'
import { Link, SquareArrowOutUpRight } from 'lucide-react'
import { StateIcon } from '../session/StateIcon'
import { LivePreview } from '../session/LivePreview'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { headlineOf, suggestWorkItems, type LogbookGroup } from '../../sidebar/logbook-groups'
import type { IssueTitles } from '../../sidebar/session-filter'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { IssueSummary } from '../../../shared/types/index'
import { DESCRIPTION_MAX_LENGTH } from '../../../shared/schemas/session-records.schema'
import './LogbookView.css'

interface Props {
  groups: LogbookGroup[]
  selected: SessionFacts | null
  titles: IssueTitles
  now: number
  onSelect: (sessionId: string) => void
  onOpen: (sessionId: string) => void
  onSaveDescription: (facts: SessionFacts, description: string | null) => void
  onLinkIssue: (facts: SessionFacts, issue: IssueSummary) => void
  onLink?: (facts: SessionFacts) => void
  renderAnswers?: (facts: SessionFacts) => React.ReactNode
}

const PROMPT = 'What is this session doing?'

function locationOf(facts: SessionFacts): string {
  const parts = [facts.workspaceName, facts.projectName, facts.branch].filter(
    (p): p is string => p !== null
  )
  return parts.length === 0 ? 'No branch' : parts.join(' / ')
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Tickets worth linking to, read once per selected session. */
function useSuggestions(facts: SessionFacts): IssueSummary[] {
  const connected = useIntegrationsStore((s) => s.isAnyConnected())
  const listMine = useIntegrationsStore((s) => s.listMine)
  const issueFor = useIntegrationsStore((s) => s.issueFor)
  const [mine, setMine] = useState<IssueSummary[]>([])

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    void listMine({ limit: 10 }).then((result) => {
      if (!cancelled) setMine(result.issues)
    })
    return () => {
      cancelled = true
    }
  }, [connected, listMine, facts.sessionId])

  if (!connected) return []
  const projectIssue = facts.projectId === null ? null : issueFor(facts.projectId)
  return suggestWorkItems(facts, projectIssue, mine)
}

function Detail({
  facts,
  now,
  onOpen,
  onSaveDescription,
  onLinkIssue,
  onLink,
  renderAnswers,
}: Omit<Props, 'groups' | 'selected' | 'titles' | 'onSelect'> & {
  facts: SessionFacts
}): JSX.Element {
  const [draft, setDraft] = useState(facts.description ?? '')
  const suggestions = useSuggestions(facts)
  const blank = facts.description === null && facts.workItem === null

  function save(): void {
    const text = draft.trim()
    onSaveDescription(facts, text === '' ? null : text)
  }

  const rows: Array<[string, string | null]> = [
    ['Workspace', facts.workspaceName],
    ['Project', facts.projectName],
    ['Branch', facts.branch],
    ['Shell', facts.shell],
    ['Started', timeOf(facts.startedAt)],
  ]

  return (
    <section role="region" aria-label="Session details" className="logbook__detail">
      <div className="logbook__crumb">
        <StateIcon state={facts.state} />
        <span className="logbook__where">{locationOf(facts)}</span>
        {!facts.isClosed && (
          <button
            type="button"
            className="logbook__button"
            aria-label={`Open ${facts.name}`}
            onClick={() => onOpen(facts.sessionId)}
          >
            <SquareArrowOutUpRight aria-hidden="true" />
            Open terminal
          </button>
        )}
      </div>

      <div className="logbook__main">
        {facts.workItem !== null && (
          <div className="logbook__work">
            <span className="logbook__key">{facts.workItem.ref.key}</span>
            <span className="logbook__source">
              {facts.workItem.source === 'project'
                ? "From the branch's link"
                : 'Linked to this session'}
            </span>
          </div>
        )}

        {facts.isClosed ? (
          <>
            {facts.description !== null && (
              <p className="logbook__closed-text">{facts.description}</p>
            )}
            <p className="logbook__muted">Closed {timeOf(facts.closedAt ?? facts.startedAt)}</p>
          </>
        ) : (
          <div className="logbook__edit">
            <label htmlFor={`logbook-description-${facts.sessionId}`}>{PROMPT}</label>
            <textarea
              id={`logbook-description-${facts.sessionId}`}
              className="logbook__textarea"
              maxLength={DESCRIPTION_MAX_LENGTH}
              value={draft}
              placeholder="Reproducing the staging 429s before the release"
              autoFocus={blank}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
              }}
            />
            <div className="logbook__actions">
              <button
                type="button"
                className="logbook__button logbook__button--primary"
                onClick={save}
              >
                Save description
              </button>
              {onLink !== undefined && (
                <button type="button" className="logbook__button" onClick={() => onLink(facts)}>
                  <Link aria-hidden="true" />
                  Link a work item
                </button>
              )}
              {renderAnswers?.(facts)}
            </div>
          </div>
        )}

        {!facts.isClosed && suggestions.length > 0 && (
          <div className="logbook__suggest">
            <h4 id={`logbook-suggest-${facts.sessionId}`}>Suggested work items</h4>
            <ul aria-labelledby={`logbook-suggest-${facts.sessionId}`}>
              {suggestions.map((issue) => (
                <li key={`${issue.tracker}:${issue.key}`}>
                  <button
                    type="button"
                    aria-label={`${issue.key} ${issue.title}`}
                    onClick={() => onLinkIssue(facts, issue)}
                  >
                    <span className="logbook__key">{issue.key}</span>
                    <span className="logbook__title">{issue.title}</span>
                    {issue.state && <span className="logbook__muted">{issue.state.name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!facts.isClosed && (
          <LivePreview sessionId={facts.sessionId} className="logbook__preview" />
        )}
      </div>

      <aside className="logbook__facts">
        <dl>
          {rows
            .filter((row): row is [string, string] => row[1] !== null)
            .map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          {facts.tags.length > 0 && (
            <>
              <dt>Tags</dt>
              <dd className="logbook__tags">
                {facts.tags.map((tag) => (
                  <span key={tag} className="logbook__tag">
                    {tag}
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>Last active</dt>
          <dd>{formatRelativeTime(facts.lastActivityAt, now)}</dd>
        </dl>
      </aside>
    </section>
  )
}

/** A list of sessions headlined by what they are for, and one session in depth. */
export function LogbookView({ groups, selected, titles, onSelect, ...detail }: Props): JSX.Element {
  return (
    <div className="logbook">
      <div role="listbox" aria-label="Sessions" className="logbook__list">
        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label} className="logbook__group">
            <div className="logbook__group-label" aria-hidden="true">
              {group.label} <span>{group.facts.length}</span>
            </div>
            {group.facts.map((facts) => {
              const headline = headlineOf(facts, titles)
              const isSelected = selected?.sessionId === facts.sessionId
              return (
                <div
                  key={facts.sessionId}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`logbook__item${isSelected ? ' logbook__item--selected' : ''}`}
                  style={
                    facts.workspaceColor
                      ? { ['--rail' as string]: facts.workspaceColor }
                      : undefined
                  }
                  onClick={() => onSelect(facts.sessionId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(facts.sessionId)
                    }
                  }}
                >
                  <StateIcon state={facts.state} />
                  <span
                    className={`logbook__headline${headline.blank ? ' logbook__headline--blank' : ''}`}
                  >
                    {headline.text}
                  </span>
                  <span className="logbook__meta">
                    {facts.workItem && (
                      <span className="logbook__key">{facts.workItem.ref.key}</span>
                    )}
                    <span className="logbook__where">
                      {[facts.projectName, facts.branch].filter(Boolean).join(' / ') || facts.name}
                    </span>
                    <span className="logbook__age">
                      {formatRelativeTime(facts.lastActivityAt, detail.now)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {selected === null ? (
        <p className="logbook__placeholder">Select a session to see what it is for</p>
      ) : (
        <Detail key={selected.sessionId} facts={selected} {...detail} />
      )}
    </div>
  )
}
