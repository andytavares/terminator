import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import type { PullRequest } from '../schemas/git.schema'
import type { ChangeDraft } from '../schemas/review-agent.schema'
import { RichContent } from './pr-review/RichContent'
import { githubAPI } from '../api/github'
import { choose, COMMIT_ERRORS } from './text'
import { gitAPI } from '../api/git'
import { requestDraft } from '../hooks/requestDraft'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface Branch {
  name: string
  isCurrent: boolean
  isRemote: boolean
}

interface PrDialogProps {
  repoRoot: string
  branch: string
  /** With staged changes the dialog commits them first, from a message the agent drafts. */
  hasStagedChanges: boolean
  existingPr: PullRequest | null
  onClose: () => void
  onCreated: (pr: PullRequest) => void
}

interface Failure {
  error: string
}

interface AheadCount {
  count: number
}

interface CreatedPr {
  pr: PullRequest
}

async function pushBeforePr(repoRoot: string): Promise<Failure | null> {
  const result = await window.electronAPI.shell.exec({
    command: 'git',
    args: ['push', '--set-upstream', 'origin', 'HEAD'],
    cwd: repoRoot,
    timeoutMs: 30000,
  })
  if ('error' in result) return { error: result.error }
  if (result.exitCode !== 0) return { error: result.stderr || 'git push failed' }
  return null
}

async function createBranch(repoRoot: string, name: string): Promise<Failure | null> {
  const result = await window.electronAPI.shell.exec({
    command: 'git',
    args: ['checkout', '-b', name],
    cwd: repoRoot,
    timeoutMs: 30000,
  })
  if ('error' in result) return { error: result.error }
  if (result.exitCode !== 0) return { error: result.stderr || `Could not create branch ${name}` }
  return null
}

function countOrZero(stdout: string): number {
  const count = parseInt(stdout.trim(), 10)
  if (isNaN(count)) return 0
  return count
}

async function checkCommitsAhead(repoRoot: string, base: string): Promise<AheadCount | Failure> {
  // Try local base branch first; fall back to origin/<base> if local doesn't exist
  for (const ref of [base, `origin/${base}`]) {
    const result = await window.electronAPI.shell.exec({
      command: 'git',
      args: ['rev-list', '--count', `${ref}..HEAD`],
      cwd: repoRoot,
    })
    if (!('error' in result) && result.exitCode === 0) return { count: countOrZero(result.stdout) }
  }
  return { error: 'could not determine commit count' }
}

/** What the dialog asks GitHub to open. */
interface PrDraft {
  repoRoot: string
  branch: string
  title: string
  body: string
  base: string
  isDraft: boolean
}

/** Checks there is something to merge, then pushes the branch so gh can find it on the remote. */
async function prepareBranch(
  draft: PrDraft,
  onStatus: (msg: string) => void
): Promise<Failure | null> {
  onStatus('Checking for commits…')
  const ahead = await checkCommitsAhead(draft.repoRoot, draft.base)
  if (!('error' in ahead) && ahead.count === 0) {
    return {
      error: `No commits ahead of "${draft.base}". Commit your changes before opening a PR.`,
    }
  }
  onStatus('Pushing branch…')
  return pushBeforePr(draft.repoRoot)
}

async function ghPrCreate(
  draft: PrDraft,
  onStatus: (msg: string) => void
): Promise<CreatedPr | Failure> {
  const prepareError = await prepareBranch(draft, onStatus)
  if (prepareError) return prepareError
  onStatus('Creating pull request…')
  const { repoRoot, title, body, base, isDraft } = draft
  const result = await githubAPI.prCreate({
    repoRoot,
    title,
    body,
    base,
    head: draft.branch,
    draft: isDraft,
  })
  if ('error' in result) return { error: result.error }
  const { number, url } = result
  const pr = {
    number,
    title,
    body,
    url,
    state: 'open',
    isDraft,
    baseRefName: base,
    headRefName: draft.branch,
  }
  return { pr: pr as PullRequest }
}

type DescriptionMode = 'write' | 'preview'

const PR_TEMPLATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
]

async function loadPrTemplate(repoRoot: string): Promise<string> {
  for (const relPath of PR_TEMPLATE_PATHS) {
    const result = await window.electronAPI.fs.readFile(`${repoRoot}/${relPath}`)
    if ('content' in result) return result.content
  }
  return ''
}

/** "feat/add-login" becomes "add login". */
function titleFromBranch(branch: string): string {
  return branch
    .replace(new RegExp('^(feat|fix|chore|docs|refactor)/', 'i'), '')
    .replaceAll('-', ' ')
}

/** Prefer main or master among local branches, else the first one. */
function defaultBase(local: Branch[]): string | undefined {
  const preferred = local.find((b) => b.name === 'main' || b.name === 'master')
  return (preferred ?? local[0])?.name
}

function isDefaultBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master'
}

/** The repository's other branches, its PR template, and a sensible base. */
function useBranchChoices(props: PrDialogProps, setBody: (body: string) => void) {
  const { repoRoot, branch, hasStagedChanges } = props
  // A new branch off the default branch opens its PR against that branch, so it stays a choice.
  const keepCurrent = hasStagedChanges && isDefaultBranch(branch)
  const [base, setBase] = useState('main')
  const [localBranches, setLocalBranches] = useState<Branch[]>([])
  const [remoteBranches, setRemoteBranches] = useState<Branch[]>([])
  useEffect(() => {
    // The draft writes the description, so a staged commit does not start from the template.
    if (!hasStagedChanges) {
      void loadPrTemplate(repoRoot).then((template) => {
        if (template) setBody(template)
      })
    }
    void window.electronAPI.git.listBranches(repoRoot).then((result) => {
      if (!('branches' in result)) return
      const others = result.branches.filter((b) => keepCurrent || b.name !== branch)
      const local = others.filter((b) => !b.isRemote)
      setLocalBranches(local)
      setRemoteBranches(others.filter((b) => b.isRemote))
      const picked = defaultBase(local)
      if (picked) setBase(picked)
    })
  }, [repoRoot, branch, hasStagedChanges, keepCurrent, setBody])
  return { base, setBase, localBranches, remoteBranches }
}

/** The agent's draft of the staged changes: loading, then either filled in or the reason it failed. */
function useStagedDraft(props: PrDialogProps, fill: (draft: ChangeDraft) => void) {
  const { repoRoot, hasStagedChanges } = props
  const [isDrafting, setIsDrafting] = useState(hasStagedChanges)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [isDrafted, setIsDrafted] = useState(false)
  useEffect(() => {
    if (!hasStagedChanges) return
    void requestDraft(repoRoot).then((result) => {
      if ('error' in result) setDraftError(result.error)
      else {
        fill(result.draft)
        setIsDrafted(true)
      }
      setIsDrafting(false)
    })
  }, [repoRoot, hasStagedChanges, fill])
  return { isDrafting, draftError, isDrafted }
}

function usePrForm(props: PrDialogProps) {
  const [title, setTitle] = useState(() =>
    props.hasStagedChanges ? '' : titleFromBranch(props.branch)
  )
  const [body, setBody] = useState('')
  const [isDraft, setIsDraft] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const branches = useBranchChoices(props, setBody)
  const fill = useCallback((draft: ChangeDraft) => {
    setTitle(draft.title)
    setBody(draft.body)
    setCommitMessage(draft.commitMessage)
    setNewBranch(draft.branch)
  }, [])
  const drafting = useStagedDraft(props, fill)
  return {
    ...{ title, setTitle, body, setBody, isDraft, setIsDraft },
    ...{ commitMessage, setCommitMessage, newBranch, setNewBranch },
    ...branches,
    ...drafting,
  }
}

type PrForm = ReturnType<typeof usePrForm>

/** A staged commit made on the default branch goes to a new branch first. */
function needsNewBranch(props: PrDialogProps): boolean {
  return props.hasStagedChanges && isDefaultBranch(props.branch)
}

function draftOf(props: PrDialogProps, form: PrForm): PrDraft {
  return {
    repoRoot: props.repoRoot,
    branch: needsNewBranch(props) ? form.newBranch.trim() : props.branch,
    title: form.title.trim(),
    body: form.body,
    base: form.base,
    isDraft: form.isDraft,
  }
}

/** The steps of one submit, and which of them a failed earlier attempt already finished. */
interface CreateRun {
  props: PrDialogProps
  form: PrForm
  onStatus: (msg: string) => void
  done: { branch: boolean; commit: boolean }
}

/** Makes the new branch if the commit needs one, commits the staged changes, then opens the PR.
 * A retry after a failed PR step skips the branch and the commit that already exist. */
async function commitThenCreate({
  props,
  form,
  onStatus,
  done,
}: CreateRun): Promise<CreatedPr | Failure> {
  const draft = draftOf(props, form)
  if (needsNewBranch(props) && !done.branch) {
    onStatus('Creating branch…')
    const failure = await createBranch(props.repoRoot, draft.branch)
    if (failure) return failure
    done.branch = true
  }
  if (!done.commit) {
    onStatus('Committing…')
    const committed = await gitAPI.commit({
      repoRoot: props.repoRoot,
      message: form.commitMessage.trim(),
    })
    recordUsage('commit', 'error' in committed ? { failed: true } : {})
    if ('error' in committed) return { error: COMMIT_ERRORS[committed.error] ?? committed.error }
    done.commit = true
  }
  return ghPrCreate(draft, onStatus)
}

/** The first thing the form still needs, or null when it can be submitted. */
function missingField(props: PrDialogProps, form: PrForm): string | null {
  if (!form.title.trim()) return 'Title is required'
  if (!props.hasStagedChanges) return null
  if (!form.commitMessage.trim()) return 'Commit message is required'
  if (needsNewBranch(props) && !form.newBranch.trim()) return 'New branch is required'
  return null
}

function ghPrCreateFrom({ props, form, onStatus }: CreateRun) {
  return ghPrCreate(draftOf(props, form), onStatus)
}

function usePrCreate(props: PrDialogProps, form: PrForm) {
  const [isCreating, setIsCreating] = useState(false)
  const [creatingStatus, setCreatingStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const done = useRef({ branch: false, commit: false })
  const handleCreate = async (): Promise<void> => {
    const missing = missingField(props, form)
    if (missing) return setError(missing)
    setIsCreating(true)
    setCreatingStatus('')
    setError(null)
    try {
      const create = props.hasStagedChanges ? commitThenCreate : ghPrCreateFrom
      const result = await create({ props, form, onStatus: setCreatingStatus, done: done.current })
      recordUsage('pr-create', 'error' in result ? { failed: true } : {})
      if ('error' in result) setError(result.error)
      else props.onCreated(result.pr)
    } catch (err) {
      recordUsage('pr-create', { failed: true })
      setError(String(err))
    } finally {
      setIsCreating(false)
      setCreatingStatus('')
    }
  }
  return { isCreating, creatingStatus, error, handleCreate }
}

type PrCreate = ReturnType<typeof usePrCreate>

function submitLabel(props: PrDialogProps, form: PrForm, isCreating: boolean): string {
  if (isCreating) return '…'
  if (props.hasStagedChanges) {
    return choose(form.isDraft, 'Commit, push and create draft PR', 'Commit, push and create PR')
  }
  return choose(form.isDraft, 'Create Draft PR', 'Create PR')
}

function prDialogActions(props: PrDialogProps, form: PrForm, create: PrCreate) {
  const { isCreating } = create
  return [
    { label: 'Cancel', disabled: isCreating, onSelect: props.onClose },
    {
      label: submitLabel(props, form, isCreating),
      tone: 'primary' as const,
      disabled: isCreating || form.isDrafting || !form.title.trim() || !!props.existingPr,
      onSelect: () => void create.handleCreate(),
    },
  ]
}

function ExistingPr({ pr }: { pr: PullRequest }) {
  return (
    <div className="pr-dialog__existing-pr">
      A PR already exists:{' '}
      <a
        href={pr.url}
        onClick={(e) => {
          e.preventDefault()
          window.electronAPI.shell.openExternal(pr.url).catch(() => {})
        }}
      >
        #{pr.number}: {pr.title}
      </a>
    </div>
  )
}

function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="pr-dialog__field">
      <label className="pr-dialog__label">{props.label}</label>
      <input
        className="pr-dialog__input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </div>
  )
}

function CommitFields({ props, form }: { props: PrDialogProps; form: PrForm }) {
  return (
    <>
      {needsNewBranch(props) && (
        <TextField
          label="New branch"
          value={form.newBranch}
          onChange={form.setNewBranch}
          placeholder="branch-name"
        />
      )}
      <TextField
        label="Commit message"
        value={form.commitMessage}
        onChange={form.setCommitMessage}
        placeholder="Commit message"
      />
    </>
  )
}

function DraftNote({ form }: { form: PrForm }) {
  if (form.isDrafting) return <p className="pr-dialog__status">Drafting from the staged diff…</p>
  if (form.draftError) return <div className="pr-dialog__error">{form.draftError}</div>
  if (!form.isDrafted) return null
  return (
    <p className="pr-dialog__note">
      Drafted by Claude from the staged diff and recent commit subjects.
    </p>
  )
}

function TitleField({ form }: { form: PrForm }) {
  return (
    <div className="pr-dialog__field">
      <label className="pr-dialog__label">Title</label>
      <input
        className="pr-dialog__input"
        value={form.title}
        onChange={(e) => form.setTitle(e.target.value)}
        placeholder="Pull request title"
      />
    </div>
  )
}

function DescriptionField({ form }: { form: PrForm }) {
  const [descMode, setDescMode] = useState<DescriptionMode>('write')
  return (
    <TabsRoot selectedId={descMode} onSelect={setDescMode}>
      <div className="pr-dialog__field">
        <div className="pr-dialog__inline pr-dialog__desc-header">
          <label className="pr-dialog__label">Description</label>
          <TabList label="Description">
            <Tab id="write">Write</Tab>
            <Tab id="preview">Preview</Tab>
          </TabList>
        </div>
        <TabPanel id="write">
          <textarea
            className="pr-dialog__textarea"
            value={form.body}
            onChange={(e) => form.setBody(e.target.value)}
            placeholder="Describe your changes… (Markdown supported)"
            rows={8}
          />
        </TabPanel>
        <TabPanel id="preview">
          <RichContent className="pr-dialog__preview">
            {form.body || '*No description*'}
          </RichContent>
        </TabPanel>
      </div>
    </TabsRoot>
  )
}

function BranchGroup({ label, branches }: { label: string; branches: Branch[] }) {
  if (branches.length === 0) return null
  return (
    <optgroup label={label}>
      {branches.map((b) => (
        <option key={b.name} value={b.name}>
          {b.name}
        </option>
      ))}
    </optgroup>
  )
}

function BaseField({ form }: { form: PrForm }) {
  const [baseFilter, setBaseFilter] = useState('')
  const matchesBaseFilter = (b: Branch) => b.name.toLowerCase().includes(baseFilter.toLowerCase())
  return (
    <div className="pr-dialog__field pr-dialog__field--flex">
      <label className="pr-dialog__label">Base branch</label>
      <input
        className="pr-dialog__input"
        placeholder="Filter branches…"
        value={baseFilter}
        onChange={(e) => setBaseFilter(e.target.value)}
        style={{ marginBottom: 4 }}
      />
      <select
        className="pr-dialog__input pr-dialog__select"
        value={form.base}
        onChange={(e) => form.setBase(e.target.value)}
        size={6}
      >
        <BranchGroup label="Local" branches={form.localBranches.filter(matchesBaseFilter)} />
        <BranchGroup label="Remote" branches={form.remoteBranches.filter(matchesBaseFilter)} />
      </select>
    </div>
  )
}

function BaseAndDraft({ form }: { form: PrForm }) {
  return (
    <div className="pr-dialog__inline">
      <BaseField form={form} />
      <label className="pr-dialog__draft-toggle">
        <input
          type="checkbox"
          checked={form.isDraft}
          onChange={(e) => form.setIsDraft(e.target.checked)}
        />
        Draft
      </label>
    </div>
  )
}

export function PrDialog(props: PrDialogProps): React.JSX.Element {
  const { branch, existingPr } = props
  const form = usePrForm(props)
  const create = usePrCreate(props, form)
  const warnsDefaultBranch = isDefaultBranch(branch) && !props.hasStagedChanges
  return (
    <Dialog
      title={choose(props.hasStagedChanges, 'Commit and open a pull request', 'Open Pull Request')}
      onDismiss={props.onClose}
      actions={prDialogActions(props, form, create)}
    >
      {existingPr && <ExistingPr pr={existingPr} />}
      {warnsDefaultBranch && (
        <div className="pr-dialog__warning">
          Warning: creating a PR from the default branch ({branch}).
        </div>
      )}
      {props.hasStagedChanges && <CommitFields props={props} form={form} />}
      <TitleField form={form} />
      <DescriptionField form={form} />
      <BaseAndDraft form={form} />
      {props.hasStagedChanges && <DraftNote form={form} />}
      {create.error && <div className="pr-dialog__error">{create.error}</div>}
      {create.isCreating && create.creatingStatus && (
        <p className="pr-dialog__status">{create.creatingStatus}</p>
      )}
    </Dialog>
  )
}
