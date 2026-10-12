import { useShallow } from 'zustand/react/shallow'
import { Dialog } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { WORKSPACE_PRESET_COLORS as PRESET_COLORS } from './workspace-colors'
import { useModalEffect } from '../../stores/modal.store'
import { DUPLICATE_NAME, WorkspaceFields, useWorkspaceForm } from './workspace-form'

interface Props {
  onClose: () => void
}

const PLACEHOLDERS = {
  name: 'My Workspace',
  folderPath: '/path/to/folder',
  tags: 'frontend, work, personal',
}

export function CreateWorkspaceDialog({ onClose }: Props): JSX.Element {
  useModalEffect()
  const { createWorkspace, createProject, workspaces } = useWorkspaceStore(
    useShallow((s) => ({
      createWorkspace: s.createWorkspace,
      createProject: s.createProject,
      workspaces: s.workspaces,
    }))
  )
  const form = useWorkspaceForm(
    { name: '', folderPath: '', color: PRESET_COLORS[0], tags: '' },
    (value) => workspaces.some((w) => w.name.toLowerCase() === value.toLowerCase())
  )

  async function handleSubmit(): Promise<void> {
    if (!form.nameIsValid()) return
    const { name, folderPath, color } = form.draft
    const result = await createWorkspace({
      name: name.trim(),
      folderPath,
      color,
      tags: form.tagList(),
    })
    if ('error' in result) {
      if (result.error === 'DUPLICATE_NAME') form.setNameError(DUPLICATE_NAME)
      else form.setError('Failed to create workspace')
      return
    }
    if (folderPath && 'workspace' in result) await addCheckout(result.workspace.id, folderPath)
    onClose()
  }

  /** A folder that is a git checkout becomes the workspace's first branch. */
  async function addCheckout(workspaceId: string, folderPath: string): Promise<void> {
    const gitInfo = await window.electronAPI.git.isRepo(folderPath)
    if (!gitInfo.isRepo) return
    const root = gitInfo.root ?? folderPath
    const branchInfo = await window.electronAPI.git.currentBranch(root)
    const branch = 'branch' in branchInfo ? branchInfo.branch : 'main'
    await createProject({
      workspaceId,
      name: branch,
      gitBranch: branch,
      worktreePath: root,
      isWorktree: false,
    })
  }

  return (
    <Dialog
      title="Create Workspace"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        {
          label: 'Create',
          tone: 'primary',
          submit: true,
          disabled: !!form.nameError,
          onSelect: handleSubmit,
        },
      ]}
    >
      <WorkspaceFields form={form} placeholders={PLACEHOLDERS} />
    </Dialog>
  )
}
