import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { WORKSPACE_PRESET_COLORS as PRESET_COLORS } from './workspace-colors'
import { recordUse } from '../../usage/record'
import { WorkspaceDialog, showSaveError, useWorkspaceForm } from './workspace-form'

interface Props {
  onClose: () => void
}

const PLACEHOLDERS = {
  name: 'My Workspace',
  folderPath: '/path/to/folder',
  tags: 'frontend, work, personal',
}

export function CreateWorkspaceDialog({ onClose }: Props): JSX.Element {
  const { form, create } = useCreateWorkspace(onClose)
  return (
    <WorkspaceDialog
      title="Create Workspace"
      submitLabel="Create"
      form={form}
      placeholders={PLACEHOLDERS}
      onSubmit={create}
      onClose={onClose}
    />
  )
}

/** A blank draft, and creating it (with its first branch) once it has a free name and a folder. */
function useCreateWorkspace(onClose: () => void) {
  const { createWorkspace, workspaces } = useWorkspaceStore(
    useShallow((s) => ({ createWorkspace: s.createWorkspace, workspaces: s.workspaces }))
  )
  const form = useWorkspaceForm(
    { name: '', folderPath: '', color: PRESET_COLORS[0], tags: '' },
    (value) => workspaces.some((w) => w.name.toLowerCase() === value.toLowerCase())
  )

  async function submitWorkspace(): Promise<void> {
    if (!form.nameIsValid()) return
    const { name, folderPath, color } = form.draft
    // Main refuses a workspace without a folder; say so before sending anything.
    if (!folderPath.trim()) {
      form.setError('Choose a folder for the workspace')
      return
    }
    const result = await createWorkspace({
      name: name.trim(),
      folderPath,
      color,
      tags: form.tagList(),
    })
    if (showSaveError(form, result, 'Failed to create workspace')) return
    const failure = await addCheckoutOrUndo(result.workspace.id, folderPath)
    if (failure === null) return onClose()
    form.setError(failure)
  }

  return { form, create: submitWorkspace }
}

/** Gives a new workspace its first branch, or takes the workspace back and says why not: one left
 * with no branches would keep its name from the retry the message asks for. */
async function addCheckoutOrUndo(workspaceId: string, folderPath: string): Promise<string | null> {
  const failure = await addCheckout(workspaceId, folderPath)
  if (failure === null) recordUse('core.sidebar.workspace-create')
  else await useWorkspaceStore.getState().deleteWorkspace(workspaceId)
  return failure
}

const GIT_UNREADABLE = 'Could not read the git repository. Try again.'
const BRANCH_NOT_ADDED = 'Could not add the branch to the workspace. Try again.'

/** A folder that is a git checkout becomes the workspace's first branch. Null when it did or
 * the folder is not a checkout; otherwise why not, because git failing to answer is not the
 * folder being a plain one, and a branch git could not name is not `main`. */
async function addCheckout(workspaceId: string, folderPath: string): Promise<string | null> {
  const gitInfo = await window.electronAPI.git.isRepo(folderPath)
  if ('error' in gitInfo) return GIT_UNREADABLE
  if (!gitInfo.isRepo) return null
  const root = gitInfo.root ?? folderPath
  const branchInfo = await window.electronAPI.git.currentBranch(root)
  if ('error' in branchInfo) return GIT_UNREADABLE
  const created = await useWorkspaceStore.getState().createProject({
    workspaceId,
    name: branchInfo.branch,
    gitBranch: branchInfo.branch,
    worktreePath: root,
    isWorktree: false,
  })
  return 'error' in created ? BRANCH_NOT_ADDED : null
}
