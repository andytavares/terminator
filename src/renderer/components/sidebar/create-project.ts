import type { Branch, Project, WorktreeInfo } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'

// The Create Branch dialog's rules and its submit, apart from its fields.

type BranchMode = 'existing' | 'worktree'

/** Everything the operator has chosen or typed so far. */
export interface ProjectDraft {
  /** Asked for only outside a repo; in a repo the branch is the name (ADR-034). */
  name: string
  branchMode: BranchMode
  selectedBranch: string
  newBranchName: string
  /** Branch tab: create the branch typed below the picker. */
  isNewBranch: boolean
  /** Worktree tab: the worktree goes on a new branch. */
  worktreeIsNewBranch: boolean
  worktreePath: string
}

/** Why the dialog stays open: said under the name field, or under the form. */
export interface Refusal {
  field: 'name' | 'form'
  message: string
}

export interface CreateRequest {
  workspaceId: string
  /** The repo's folder, where a new branch is created. */
  folderPath: string
  gitRoot: string | null
  draft: ProjectDraft
}

/** What the card will be called: its branch, or a supplied name if it has none. */
export function validateProjectName(value: string, existing: Project[]): string {
  if (!value.trim()) return 'Name is required'
  if (value.length > 100) return 'Name must be 100 characters or less'
  if (existing.some((p) => p.name.toLowerCase() === value.toLowerCase())) {
    return 'A branch with this name already exists in this repo'
  }
  return ''
}

/** Drops what git refuses in a branch name, as it is typed. */
export function sanitizeBranchName(value: string): string {
  return (
    value
      .replace(/ /g, '-')
      // eslint-disable-next-line no-control-regex
      .replace(/[~^:?*[\\\x00-\x1f\x7f]/g, '')
      .replace(/\.\.+/g, '.')
      // Only the leading end: stripping a trailing `/` on every keystroke
      // made `feature/login` impossible to type. The tail is trimmed on submit.
      .replace(/^[./]+/, '')
  )
}

/** The typed branch name as submitted: trimmed, with no trailing `.` or `/`. */
function typedBranchName(draft: ProjectDraft): string {
  return draft.newBranchName.trim().replace(/[./]+$/, '')
}

/** The repo's branches with `main`, else `master`, first. */
export function defaultBranchFirst(branches: Branch[]): Branch[] {
  const names = new Set(branches.map((b) => b.name))
  const preferred = names.has('main') ? 'main' : names.has('master') ? 'master' : null
  if (preferred === null) return branches
  const isPreferred = (b: Branch): boolean => b.name === preferred
  return [...branches.filter(isPreferred), ...branches.filter((b) => !isPreferred(b))]
}

/** Branches no worktree is on yet. */
export function freeBranches(branches: Branch[], worktrees: WorktreeInfo[]): Branch[] {
  const used = new Set(worktrees.map((w) => w.branch))
  return branches.filter((b) => !used.has(b.name))
}

/** Creates the branch's card, and first the branch or worktree it needs. The created project's
 * id, or why nothing was created. */
export async function createFromDraft(request: CreateRequest): Promise<string | Refusal> {
  if (request.gitRoot && request.draft.branchMode === 'worktree') {
    return createOnWorktree(request.gitRoot, request)
  }
  return createOnBranch(request)
}

/** A card on an existing or new branch of the repo, or a named card outside one. */
async function createOnBranch({
  workspaceId,
  folderPath,
  gitRoot,
  draft,
}: CreateRequest): Promise<string | Refusal> {
  const branch =
    gitRoot && draft.isNewBranch ? await newBranch(folderPath, draft) : draft.selectedBranch
  if (typeof branch !== 'string') return branch
  // In a repo the branch is the card's name, so a card with no branch would
  // be a card with no name.
  if (gitRoot && !branch) return formRefusal('Select or enter a branch name')
  const result = await useWorkspaceStore.getState().createProject({
    workspaceId,
    name: branch || draft.name.trim(),
    ...(branch ? { gitBranch: branch } : {}),
  })
  return 'error' in result ? projectRefusal(result.error, gitRoot) : result.project.id
}

async function newBranch(folderPath: string, draft: ProjectDraft): Promise<string | Refusal> {
  const branch = typedBranchName(draft)
  if (!branch) return formRefusal('Enter a branch name')
  const created = await window.electronAPI.git.createBranch(folderPath, branch)
  if ('error' in created) return formRefusal(`Could not create branch: ${created.error}`)
  return branch
}

/** A worktree on a new or existing branch, then its card. */
async function createOnWorktree(
  gitRoot: string,
  { workspaceId, draft }: CreateRequest
): Promise<string | Refusal> {
  const branch = draft.worktreeIsNewBranch ? typedBranchName(draft) : draft.selectedBranch
  if (!branch) return formRefusal('Select or enter a branch name')
  const { worktreePath } = draft
  const wt = await window.electronAPI.git.createWorktree({
    repoRoot: gitRoot,
    worktreePath,
    branch,
    isNewBranch: draft.worktreeIsNewBranch,
  })
  if ('error' in wt) return formRefusal(`Worktree error: ${wt.error}`)
  const result = await useWorkspaceStore.getState().createProject({
    workspaceId,
    name: branch,
    gitBranch: branch,
    worktreePath,
    isWorktree: true,
  })
  return 'error' in result ? projectRefusal(result.error, gitRoot) : result.project.id
}

function formRefusal(message: string): Refusal {
  return { field: 'form', message }
}

/** A card the store refused, said where the operator will see it. */
function projectRefusal(error: string, gitRoot: string | null): Refusal {
  const duplicate = error === 'DUPLICATE_NAME'
  // With a repo the name is the branch, and the Name field it would be
  // reported under is not rendered — so that case has to speak up here.
  if (duplicate && !gitRoot) {
    return { field: 'name', message: 'A branch with this name already exists' }
  }
  return formRefusal(
    duplicate ? 'This repo already has that branch' : 'Could not create the branch'
  )
}
