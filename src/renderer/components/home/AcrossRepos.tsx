import React, { useState } from 'react'
import { Button, Checkbox, Kbd } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk/plain'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { RunAsChoices } from './RunAsChoices'
import { branchSlug, startAcrossRepos, type AcrossResult, type RepoMessages } from './across-repos'
import { useRepoGit, useMyTickets } from './start-work-model'
import { useRunAsOptions, type RunAs } from './start-work'
import { TASK_TITLE_MAX_LENGTH } from '../../../shared/task-title'
import type { IssueSummary, Workspace } from '../../../shared/types/index'
import './AcrossRepos.css'

/** What the person has typed and ticked; the branch follows the title until they type their own. */
function useAcrossFields(workspaces: Workspace[]) {
  const [title, setTitle] = useState('')
  const [typedBranch, setTypedBranch] = useState<string | null>(null)
  const [ticket, setTicket] = useState<IssueSummary | null>(null)
  const [prompt, setPrompt] = useState('')
  const [runAs, setRunAs] = useState<RunAs>('agent')
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string): void =>
    setUnticked((now) => {
      const next = new Set(now)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return {
    ...{ title, ticket, prompt, runAs, setTitle, setTicket, setPrompt, setRunAs, toggle },
    branch: typedBranch ?? branchSlug(title),
    setBranch: setTypedBranch,
    chosen: workspaces.filter((w) => !unticked.has(w.id)),
  }
}

type Fields = ReturnType<typeof useAcrossFields>

/** The notes under each repo, and the sentence that sums them up, after Start was pressed. */
function describeResult(result: AcrossResult, chosenCount: number) {
  const notes: RepoMessages = new Map([...result.problems, ...result.failures])
  for (const workspace of result.started) notes.set(workspace.id, 'Started')
  if (result.problems.size > 0)
    return { notes, summary: 'Nothing was started. Fix the repos named below, or untick them.' }
  if (result.started.length === 0)
    return { notes, summary: 'No lane was started. The repos below say why.' }
  const made = `${result.started.length} of ${chosenCount} ${plural(chosenCount, 'lane')} started`
  if (result.started.length > 0 && !result.recorded)
    return { notes, summary: `${made}, but the task could not be saved.` }
  if (result.failures.size === 0) return { notes, summary: '' }
  return { notes, summary: `${made} and recorded as the task. The rest are named below.` }
}

function useAcrossRun(fields: Fields, onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const [outcome, setOutcome] = useState({ notes: new Map() as RepoMessages, summary: '' })
  const start = async (): Promise<void> => {
    setBusy(true)
    const { title, branch, prompt, runAs, ticket, chosen } = fields
    const request = {
      ...{ title, branch, prompt, runAs, workspaces: chosen },
      ticket: ticket && { tracker: ticket.tracker, key: ticket.key },
    }
    const result = await startAcrossRepos(request)
    const described = describeResult(result, chosen.length)
    setBusy(false)
    if (described.summary === '') return onClose()
    setOutcome(described)
    setFinished(result.started.length > 0)
  }
  return { busy, finished, ...outcome, start }
}

type Run = ReturnType<typeof useAcrossRun>

/** A title, a branch and at least one repo: enough to start. */
const isReady = (fields: Fields): boolean =>
  fields.title.trim() !== '' && fields.branch !== '' && fields.chosen.length > 0

/** Start work's Across repos tab: one title and branch, a checkbox per repo, one task. */
export function AcrossRepos({ onClose }: { onClose: () => void }): JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const fields = useAcrossFields(workspaces)
  const run = useAcrossRun(fields, onClose)
  const ready = isReady(fields)
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    if (ready && !run.busy && !run.finished) void run.start()
  }
  return (
    <div className="across-repos" onKeyDown={onKeyDown}>
      <div className="across-repos__body">
        <TaskFields fields={fields} />
        <RepoChoices workspaces={workspaces} fields={fields} notes={run.notes} />
      </div>
      <Footer {...{ fields, run, onClose }} />
    </div>
  )
}

function TaskFields({ fields }: { fields: Fields }): JSX.Element {
  return (
    <div className="across-repos__fields">
      <label>
        Task title
        <input
          autoFocus
          aria-label="Task title"
          maxLength={TASK_TITLE_MAX_LENGTH}
          value={fields.title}
          onChange={(e) => fields.setTitle(e.target.value)}
        />
      </label>
      <label>
        Branch in every repo
        <input
          aria-label="Branch in every repo"
          value={fields.branch}
          onChange={(e) => fields.setBranch(e.target.value)}
        />
      </label>
      <TicketField fields={fields} />
      <PromptField fields={fields} />
    </div>
  )
}

function PromptField({ fields }: { fields: Fields }): JSX.Element {
  return (
    <label>
      First prompt for each agent (optional)
      <textarea
        aria-label="First prompt for each agent"
        rows={3}
        value={fields.prompt}
        onChange={(e) => fields.setPrompt(e.target.value)}
      />
    </label>
  )
}

function TicketField({ fields }: { fields: Fields }): JSX.Element {
  const issues = useMyTickets()
  const pick = (key: string): void => {
    const issue = issues.find((i) => i.key === key) ?? null
    fields.setTicket(issue)
    if (issue !== null && fields.title.trim() === '')
      fields.setTitle(issue.title.slice(0, TASK_TITLE_MAX_LENGTH))
  }
  return (
    <label>
      Ticket (optional)
      <select
        aria-label="Ticket"
        value={fields.ticket?.key ?? ''}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">No ticket</option>
        {issues.map((issue) => (
          <option key={issue.id} value={issue.key}>
            {`${issue.key} · ${issue.title}`}
          </option>
        ))}
      </select>
    </label>
  )
}

interface RepoChoicesProps {
  workspaces: Workspace[]
  fields: Fields
  notes: RepoMessages
}

function RepoChoices({ workspaces, fields, notes }: RepoChoicesProps): JSX.Element {
  const options = useRunAsOptions()
  return (
    <div className="across-repos__repos">
      <div className="start-work__label">Repos</div>
      <ul aria-label="Repos" className="across-repos__list">
        {workspaces.map((workspace) => (
          <RepoRow
            key={workspace.id}
            workspace={workspace}
            fields={fields}
            note={notes.get(workspace.id)}
          />
        ))}
      </ul>
      <div className="start-work__label">Run as</div>
      <RunAsChoices options={options} runAs={fields.runAs} onPick={fields.setRunAs} />
    </div>
  )
}

interface RepoRowProps {
  workspace: Workspace
  fields: Fields
  note: string | undefined
}

function RepoRow({ workspace, fields, note }: RepoRowProps): JSX.Element {
  const { base } = useRepoGit(workspace)
  return (
    <li aria-label={workspace.name} className="across-repos__repo">
      <Checkbox
        checked={fields.chosen.includes(workspace)}
        label={workspace.name}
        onChange={() => fields.toggle(workspace.id)}
      />
      <span>{workspace.name}</span>
      <small>{base === null ? '' : `from ${base}`}</small>
      {note !== undefined && <span className="across-repos__note">{note}</span>}
    </li>
  )
}

interface FooterProps {
  fields: Fields
  run: Run
  onClose: () => void
}

function Footer({ fields, run, onClose }: FooterProps): JSX.Element {
  const count = fields.chosen.length
  const ready = isReady(fields)
  return (
    <div className="start-work__footer">
      {run.summary !== '' && (
        <span role="alert" className="start-work__error">
          {run.summary}
        </span>
      )}
      {run.finished ? (
        <Button variant="primary" size="sm" onClick={onClose}>
          Close
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          disabled={!ready || run.busy}
          onClick={() => void run.start()}
        >
          {`Start ${count} ${plural(count, 'lane')}`}
          <Kbd>⌘↵</Kbd>
        </Button>
      )}
    </div>
  )
}
