import { useState, useEffect, useCallback } from 'react'
import { Dialog, type DialogAction } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import type { Branch, IssueSummary, Project, WorktreeInfo } from '../../../shared/types/index'
import { BranchSelect } from './BranchSelect'
import { useModalEffect } from '../../stores/modal.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { IssuePicker } from '../integrations/IssuePicker'
import { branchFromIssue } from '../../../shared/integrations/branch-from-issue'
import {
  createFromDraft,
  defaultBranchFirst,
  freeBranches,
  sanitizeBranchName,
  validateProjectName,
  type ProjectDraft,
} from './create-project'
import './dialog-fields.css'

interface Props {
  workspaceId: string
  onClose: () => void
}

export function CreateProjectDialog({ workspaceId, onClose }: Props): JSX.Element {
  useModalEffect()
  const form = useCreateProjectForm(workspaceId, onClose)
  const { busy, repo, fields } = form

  return (
    // Dismissing mid-flight would leave git finishing a worktree nothing is
    // waiting for, so the scrim and Escape stop answering until the work is done.
    <Dialog
      title="Create Branch"
      dismissible={!busy}
      onDismiss={() => !busy && onClose()}
      actions={dialogActions(form, onClose)}
    >
      <IssueField fields={fields} />
      {/* A branch is named by its branch (ADR-034). Only a folder that is
          not a repo has no branch to take a name from, and there the
          operator still has to supply one. */}
      {!repo.gitRoot && <NameField form={form} />}
      {repo.gitRoot && <RepoBranchFields form={form} />}
      {fields.error && <p className="dialog__error">{fields.error}</p>}
    </Dialog>
  )
}

type Form = ReturnType<typeof useCreateProjectForm>

function dialogActions({ busy, fields, submit }: Form, onClose: () => void): DialogAction[] {
  return [
    { label: 'Cancel', disabled: busy, onSelect: onClose },
    {
      label: busy ? 'Creating…' : 'Create',
      tone: 'primary',
      submit: true,
      disabled: !!fields.nameError || busy,
      onSelect: submit,
    },
  ]
}

/** The dialog's state: the repo it creates in, what has been entered, and the submit. */
function useCreateProjectForm(workspaceId: string, onClose: () => void) {
  const target = useTarget(workspaceId)
  const fields = useProjectFields(target.hasNonWorktreeProject)
  const repo = useRepo(target.folderPath, fields.update)
  const fetch = useBranchFetch(repo, fields.setError)
  useWorktreePath(fields, { gitRoot: repo.gitRoot, baseDir: target.worktreeBaseDir })
  const [busy, setBusy] = useState(false)
  // Creating a worktree is seconds of git work. Without `busy` the dialog sits
  // there looking untouched, and a second press starts the whole thing again.
  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      if (await create({ target, repo, fields })) onClose()
    } finally {
      setBusy(false)
    }
  }
  return { target, fields, repo, ...fetch, busy, submit }
}

const NO_PROJECTS: Project[] = []

/** The repo the branch is created in, what it has already, and where its worktrees go. */
function useTarget(workspaceId: string) {
  const folderPath = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === workspaceId)?.folderPath
  )
  const existing = useWorkspaceStore((s) => s.projectsByWorkspaceId.get(workspaceId)) ?? NO_PROJECTS
  const worktreeBaseDir = useSettingsStore(
    (s) => s.resolveSettings(workspaceId).git.worktreeBaseDir || undefined
  )
  const hasNonWorktreeProject = existing.some((p) => !p.isWorktree)
  return { workspaceId, folderPath, existing, hasNonWorktreeProject, worktreeBaseDir }
}

type Update = (patch: Partial<ProjectDraft>) => void

/** The draft, its two errors, and the issue it was started from. */
function useProjectFields(hasNonWorktreeProject: boolean) {
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    name: '',
    branchMode: hasNonWorktreeProject ? 'worktree' : 'existing',
    selectedBranch: '',
    newBranchName: '',
    isNewBranch: false,
    worktreeIsNewBranch: true,
    worktreePath: '',
  }))
  const update: Update = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), [])
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const issue = useStartingIssue(update, setNameError)
  return { draft, update, nameError, setNameError, error, setError, ...issue }
}

/** The issue the operator started from: it prefills the form once, and is linked once the project
 * exists. Fields are never derived again: an operator who renamed the branch meant it. */
function useStartingIssue(update: Update, setNameError: (error: string) => void) {
  const [issue, setIssue] = useState<IssueSummary | null>(null)
  const applyIssue = (picked: IssueSummary): void => {
    setIssue(picked)
    setNameError('')
    update({
      worktreeIsNewBranch: true,
      newBranchName: branchFromIssue(picked),
      branchMode: 'worktree',
    })
  }
  return { issue, applyIssue, clearIssue: () => setIssue(null) }
}

/** Whether the folder is a git repo and, if so, its branches and worktrees. */
function useRepo(folderPath: string | undefined, update: Update) {
  const [gitRoot, setGitRoot] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])

  useEffect(() => {
    if (!folderPath) return
    void window.electronAPI.git.isRepo(folderPath).then((info) => {
      if (!info.isRepo || !info.root) return
      setGitRoot(info.root)
      void window.electronAPI.git.listBranches(info.root).then((r) => {
        setBranches(r.branches)
        const current = r.branches.find((b) => b.isCurrent)
        if (current) update({ selectedBranch: current.name })
      })
      void window.electronAPI.git.listWorktrees(info.root).then((r) => setWorktrees(r.worktrees))
    })
  }, [folderPath, update])

  return { gitRoot, branches, setBranches, worktrees }
}

type Repo = ReturnType<typeof useRepo>

/** Fetching from the remote, then relisting, so newly pushed branches can be chosen. */
function useBranchFetch({ gitRoot, setBranches }: Repo, setError: (error: string) => void) {
  const [fetching, setFetching] = useState(false)
  async function fetchBranches(): Promise<void> {
    if (!gitRoot) return
    setFetching(true)
    setError('')
    try {
      const fetched = await window.electronAPI.git.fetch(gitRoot)
      if ('error' in fetched) return setError(`Could not fetch: ${fetched.error}`)
      setBranches((await window.electronAPI.git.listBranches(gitRoot)).branches)
    } finally {
      setFetching(false)
    }
  }
  return { fetching, fetchBranches }
}

type Fields = ReturnType<typeof useProjectFields>

/** Keeps the worktree path following the branch: git's suggestion for it, or, before one is
 * named, the base directory, so users can see where worktrees go by default. */
function useWorktreePath(
  { draft, update }: Fields,
  { gitRoot, baseDir }: { gitRoot: string | null; baseDir: string | undefined }
): void {
  const { branchMode, worktreeIsNewBranch } = draft
  const branch = worktreeIsNewBranch ? draft.newBranchName : draft.selectedBranch
  const inputs = [gitRoot, branchMode, worktreeIsNewBranch, branch, baseDir].join('|')
  const [inputsSeen, setInputsSeen] = useState(inputs)
  if (inputsSeen !== inputs) {
    setInputsSeen(inputs)
    if (gitRoot && branchMode === 'worktree' && !branch) {
      update({ worktreePath: baseDir ?? `${gitRoot}/.worktrees` })
    }
  }

  useEffect(() => {
    if (!gitRoot || branchMode !== 'worktree' || !branch) return
    void window.electronAPI.git
      .suggestWorktreePath(gitRoot, branch, baseDir)
      .then((r) => update({ worktreePath: r.path }))
  }, [gitRoot, branchMode, branch, baseDir, update])
}

interface FormCore {
  target: ReturnType<typeof useTarget>
  repo: Repo
  fields: Fields
}

/** The work itself. True when the branch exists and the dialog can go. */
async function create({ target, repo, fields }: FormCore): Promise<boolean> {
  // Only a non-repo folder carries a name of its own; everywhere else the
  // branch chosen below is the name, and it is validated where it is chosen.
  if (!repo.gitRoot) {
    const nameErr = validateProjectName(fields.draft.name, target.existing)
    if (nameErr) return refuse(fields.setNameError, nameErr)
  }
  fields.setError('')
  if (fields.draft.branchMode === 'existing' && target.hasNonWorktreeProject) {
    return refuse(fields.setError, 'A branch-based entry already exists in this repo')
  }
  const outcome = await createFromDraft({
    workspaceId: target.workspaceId,
    folderPath: target.folderPath ?? '',
    gitRoot: repo.gitRoot,
    draft: fields.draft,
  })
  if (typeof outcome !== 'string') {
    return refuse(outcome.field === 'name' ? fields.setNameError : fields.setError, outcome.message)
  }
  await attachIssue(outcome, fields.issue)
  return true
}

function refuse(show: (message: string) => void, message: string): false {
  show(message)
  return false
}

/** The project exists; give it the issue it was created for (FR-011). */
async function attachIssue(projectId: string, issue: IssueSummary | null): Promise<void> {
  if (issue === null) return
  await useIntegrationsStore
    .getState()
    .linkIssue(projectId, { tracker: issue.tracker, key: issue.key })
}

/** Starting from an issue, offered only while a tracker is connected. */
function IssueField({ fields }: { fields: Fields }) {
  const anyConnected = useIntegrationsStore((s) => s.isAnyConnected())
  if (!anyConnected) return null
  return (
    <div className="dialog__field">
      <label className="dialog__label">Start from an issue</label>
      <IssuePicker
        selected={fields.issue}
        onSelect={fields.applyIssue}
        onClear={fields.clearIssue}
      />
      {fields.issue !== null && (
        <span className="dialog__hint">
          Branch filled in from {fields.issue.key}. It stays editable.
        </span>
      )}
    </div>
  )
}

/** The card's own name, for a folder that is not a repo. */
function NameField({ form }: { form: Form }): JSX.Element {
  const { draft, update, nameError, setNameError } = form.fields
  return (
    <div className="dialog__field">
      <label className="dialog__label">Name *</label>
      <input
        className={`dialog__input${nameError ? ' dialog__input--error' : ''}`}
        value={draft.name}
        onChange={(e) => {
          update({ name: e.target.value })
          setNameError('')
        }}
        onBlur={() => setNameError(validateProjectName(draft.name, form.target.existing))}
        placeholder="My branch"
        autoFocus
      />
      {nameError && <span className="dialog__error">{nameError}</span>}
    </div>
  )
}

/** Branch or Worktree, then that mode's fields. */
function RepoBranchFields({ form }: { form: Form }): JSX.Element {
  return (
    <>
      <ModeSwitch form={form} />
      {form.fields.draft.branchMode === 'existing' ? (
        <ExistingBranchFields form={form} />
      ) : (
        <WorktreeFields form={form} />
      )}
    </>
  )
}

/** Branch is unavailable once the repo has a branch-based entry: there can be only one. */
function ModeSwitch({ form }: { form: Form }): JSX.Element {
  const { branchMode } = form.fields.draft
  const locked = form.target.hasNonWorktreeProject
  const segment = (on: boolean): string =>
    `dialog__segment-btn${on ? ' dialog__segment-btn--active' : ''}`
  return (
    <div className="dialog__field">
      <label className="dialog__label">Branch</label>
      <div className="dialog__segment">
        <button
          type="button"
          className={`${segment(branchMode === 'existing')}${locked ? ' dialog__segment-btn--disabled' : ''}`}
          onClick={() => !locked && form.fields.update({ branchMode: 'existing' })}
          disabled={locked}
          title={locked ? 'A branch-based entry already exists in this repo' : undefined}
        >
          Branch
        </button>
        <button
          type="button"
          className={segment(branchMode === 'worktree')}
          onClick={() => form.fields.update({ branchMode: 'worktree' })}
        >
          Worktree
        </button>
      </div>
    </div>
  )
}

/** The props both modes' branch pickers share: the selection, the new-branch item and fetching. */
function pickerProps(form: Form, isNewSelected: boolean) {
  return {
    value: form.fields.draft.selectedBranch,
    newBranchLabel: '+ New branch…',
    isNewSelected,
    onRefresh: () => void form.fetchBranches(),
    refreshing: form.fetching,
  }
}

/** Branch mode: one of the repo's branches, or a new one typed below. */
function ExistingBranchFields({ form }: { form: Form }): JSX.Element {
  const { draft, update } = form.fields
  return (
    <>
      <div className="dialog__field">
        <BranchSelect
          {...pickerProps(form, draft.isNewBranch)}
          branches={defaultBranchFirst(form.repo.branches)}
          onChange={(b) => update({ isNewBranch: false, selectedBranch: b })}
          onNewBranch={() => update({ isNewBranch: true })}
        />
      </div>
      {draft.isNewBranch && (
        <div className="dialog__field">
          <NewBranchInput form={form} autoFocus />
        </div>
      )}
    </>
  )
}

function NewBranchInput({ form, autoFocus }: { form: Form; autoFocus?: boolean }): JSX.Element {
  return (
    <input
      className="dialog__input"
      value={form.fields.draft.newBranchName}
      onChange={(e) => form.fields.update({ newBranchName: sanitizeBranchName(e.target.value) })}
      placeholder="feature/my-feature"
      autoFocus={autoFocus}
    />
  )
}

/** Worktree mode: a branch no worktree is on yet, or a new one, and where the worktree goes. */
function WorktreeFields({ form }: { form: Form }): JSX.Element {
  const { draft, update } = form.fields
  return (
    <>
      <div className="dialog__field">
        <label className="dialog__label">Branch</label>
        <BranchSelect
          {...pickerProps(form, draft.worktreeIsNewBranch)}
          branches={freeBranches(defaultBranchFirst(form.repo.branches), form.repo.worktrees)}
          onChange={(b) => update({ worktreeIsNewBranch: false, selectedBranch: b })}
          onNewBranch={() => update({ worktreeIsNewBranch: true })}
        />
      </div>
      {draft.worktreeIsNewBranch && (
        <div className="dialog__field">
          <label className="dialog__label">New branch name</label>
          <NewBranchInput form={form} />
        </div>
      )}
      <WorktreePathField fields={form.fields} />
    </>
  )
}

function WorktreePathField({ fields: { draft, update } }: { fields: Fields }): JSX.Element {
  const branch = draft.worktreeIsNewBranch ? draft.newBranchName : draft.selectedBranch
  return (
    <div className="dialog__field">
      <label className="dialog__label">Worktree path</label>
      <div className="dialog__row">
        <input
          className="dialog__input"
          value={draft.worktreePath}
          onChange={(e) => update({ worktreePath: e.target.value })}
          placeholder={branch ? `Suggested based on "${branch}"` : '/path/to/worktree'}
        />
      </div>
      <span className="dialog__hint">Directory will be created by git</span>
    </div>
  )
}
