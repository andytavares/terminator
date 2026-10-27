import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, type DialogAction } from '@terminator/extension-ui'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useModalEffect } from '../../stores/modal.store'
import type { IssueSummary } from '../../../shared/types/index'
import { ERROR_TEXT, TRACKER_LABELS, useIssueSearch } from './use-issue-search'
import './issue-search.css'
import './LinkIssueDialog.css'

// Picking the issue a project is for.
//
// Opens on the operator's own assigned issues, because that is what they are
// almost always reaching for — a picker that demands a search first makes the
// common case the slow one.

export interface LinkIssueDialogProps {
  projectId: string
  projectName: string
  /** The key currently attached, if any — drives the replacement warning. */
  currentKey?: string | null
  onClose: () => void
  onLinked?: (issue: IssueSummary) => void
}

export function LinkIssueDialog(props: LinkIssueDialogProps): JSX.Element {
  useModalEffect()
  const connected = useConnectedTrackers()
  const [term, setTerm] = useState('')
  const link = useLinkCommit(props)

  return (
    <Dialog
      title="Link an issue"
      onDismiss={props.onClose}
      actions={linkActions(link, props.onClose)}
    >
      <div className="link-issue">
        <p className="tmui-dialog__description">
          Attaching to <strong>{props.projectName}</strong>
        </p>
        {connected ? (
          <IssueChoice {...props} term={term} setTerm={setTerm} link={link} />
        ) : (
          <NotConnected />
        )}
      </div>
    </Dialog>
  )
}

type LinkCommit = ReturnType<typeof useLinkCommit>

function linkActions({ selected, busy, commit }: LinkCommit, onClose: () => void): DialogAction[] {
  return [
    { label: 'Cancel', onSelect: onClose },
    {
      label: busy ? 'Linking…' : selected === null ? 'Link issue' : `Link ${selected.key}`,
      tone: 'primary',
      disabled: selected === null || busy,
      onSelect: commit,
    },
  ]
}

/** Whether any tracker is connected, asking main again as the dialog opens. */
function useConnectedTrackers(): boolean {
  const { isAnyConnected, loadConnections } = useIntegrationsStore(
    useShallow((s) => ({
      isAnyConnected: s.isAnyConnected,
      loadConnections: s.loadConnections,
      connections: s.connections,
    }))
  )
  useEffect(() => {
    void loadConnections()
  }, [loadConnections])
  return isAnyConnected()
}

/** The picked issue, and attaching it to the project. */
function useLinkCommit({ projectId, onClose, onLinked }: LinkIssueDialogProps) {
  const linkIssue = useIntegrationsStore((s) => s.linkIssue)
  const [selected, setSelected] = useState<IssueSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function commit(): Promise<void> {
    if (selected === null) return
    setBusy(true)
    const ok = await linkIssue(projectId, { tracker: selected.tracker, key: selected.key })
    setBusy(false)
    if (!ok) {
      setError('Could not attach that issue. Nothing was changed.')
      return
    }
    onLinked?.(selected)
    onClose()
  }

  return { selected, setSelected, busy, error, commit }
}

function NotConnected(): JSX.Element {
  return (
    <div className="link-issue__empty">
      <p>No issue tracker is connected.</p>
      <p className="link-issue__hint">Connect Linear in Settings → Integrations, then come back.</p>
    </div>
  )
}

interface IssueChoiceProps extends LinkIssueDialogProps {
  term: string
  setTerm: (term: string) => void
  link: ReturnType<typeof useLinkCommit>
}

/** The search, what failed, the list, and what linking would replace. */
function IssueChoice({ term, setTerm, link, projectName, currentKey }: IssueChoiceProps) {
  const { result, loading } = useIssueSearch(term, true)
  const { selected, error } = link
  return (
    <>
      <div className="link-issue__search">
        <Search />
        <input
          className="link-issue__input"
          autoFocus
          value={term}
          placeholder="Search, or type an issue key"
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <SearchFailures failures={result.failures} />
      <IssueList term={term} issues={result.issues} loading={loading} link={link} />
      {currentKey != null && selected !== null && selected.key !== currentKey && (
        <ReplaceWarning projectName={projectName} currentKey={currentKey} next={selected.key} />
      )}
      {error !== null && (
        <p className="link-issue__warning" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

interface ReplaceWarningProps {
  projectName: string
  currentKey: string
  next: string
}

function ReplaceWarning({ projectName, currentKey, next }: ReplaceWarningProps): JSX.Element {
  return (
    <p className="link-issue__warning" role="alert">
      {projectName} is attached to {currentKey}. Linking {next} replaces it — a branch holds one
      issue.
    </p>
  )
}

type SearchResult = ReturnType<typeof useIssueSearch>['result']

function SearchFailures({ failures }: { failures: SearchResult['failures'] }) {
  if (failures.length === 0) return null
  return (
    <p className="link-issue__failures" role="status">
      {failures
        .map((f) => `${TRACKER_LABELS[f.tracker]} ${ERROR_TEXT[f.error] ?? f.error}`)
        .join(' · ')}
    </p>
  )
}

interface IssueListProps {
  term: string
  issues: IssueSummary[]
  loading: boolean
  link: ReturnType<typeof useLinkCommit>
}

/** Assigned issues until something is typed, then results; a double click links one. */
function IssueList({ term, issues, loading, link }: IssueListProps): JSX.Element {
  const { selected } = link
  const isSelected = (issue: IssueSummary): boolean =>
    selected?.key === issue.key && selected.tracker === issue.tracker
  return (
    <div className="link-issue__list">
      <div className="link-issue__group">
        {term.trim().length === 0 ? 'Assigned to you' : 'Results'}
      </div>
      {loading && <div className="link-issue__row link-issue__row--muted">Loading…</div>}
      {!loading && issues.length === 0 && (
        <div className="link-issue__row link-issue__row--muted">No issues found.</div>
      )}
      {!loading &&
        issues.map((issue) => (
          <IssueRow
            key={`${issue.tracker}:${issue.key}`}
            issue={issue}
            selected={isSelected(issue)}
            onSelect={() => link.setSelected(issue)}
            onLink={() => void link.commit()}
          />
        ))}
    </div>
  )
}

interface IssueRowProps {
  issue: IssueSummary
  selected: boolean
  onSelect: () => void
  onLink: () => void
}

function IssueRow({ issue, selected, onSelect, onLink }: IssueRowProps): JSX.Element {
  return (
    <button
      type="button"
      className={`link-issue__row${selected ? ' link-issue__row--selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={onLink}
    >
      <span className="link-issue__key">{issue.key}</span>
      <span className="link-issue__title">{issue.title}</span>
      <span className="link-issue__tracker">{TRACKER_LABELS[issue.tracker]}</span>
      <span className="link-issue__state">{issue.state.name}</span>
    </button>
  )
}
