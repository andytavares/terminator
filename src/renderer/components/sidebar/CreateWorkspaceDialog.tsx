import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { WORKSPACE_PRESET_COLORS as PRESET_COLORS } from './workspace-colors'
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
    await addCheckout(result.workspace.id, folderPath)
    onClose()
  }

  return { form, create: submitWorkspace }
}

/** A folder that is a git checkout becomes the workspace's first branch. */
async function addCheckout(workspaceId: string, folderPath: string): Promise<void> {
  const gitInfo = await window.electronAPI.git.isRepo(folderPath)
  if (!gitInfo.isRepo) return
  const root = gitInfo.root ?? folderPath
  const branchInfo = await window.electronAPI.git.currentBranch(root)
  const branch = 'branch' in branchInfo ? branchInfo.branch : 'main'
  await useWorkspaceStore.getState().createProject({
    workspaceId,
    name: branch,
    gitBranch: branch,
    worktreePath: root,
    isWorktree: false,
  })
}
