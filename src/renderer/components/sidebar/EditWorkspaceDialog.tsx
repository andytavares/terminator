import { useShallow } from 'zustand/react/shallow'
import type { Workspace } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { WorkspaceDialog, showSaveError, useWorkspaceForm } from './workspace-form'

interface Props {
  workspace: Workspace
  onClose: () => void
}

export function EditWorkspaceDialog({ workspace, onClose }: Props): JSX.Element {
  const { form, save } = useEditWorkspace(workspace, onClose)
  return (
    <WorkspaceDialog
      title="Edit Workspace"
      submitLabel="Save"
      form={form}
      onSubmit={save}
      onClose={onClose}
    />
  )
}

/** The workspace's draft, and saving it unless its new name is another's. */
function useEditWorkspace(workspace: Workspace, onClose: () => void) {
  const { updateWorkspace, workspaces } = useWorkspaceStore(
    useShallow((s) => ({ updateWorkspace: s.updateWorkspace, workspaces: s.workspaces }))
  )
  const form = useWorkspaceForm(
    {
      name: workspace.name,
      folderPath: workspace.folderPath,
      color: workspace.color,
      tags: workspace.tags.join(', '),
    },
    (value) =>
      value.toLowerCase() !== workspace.name.toLowerCase() &&
      workspaces.some((w) => w.name.toLowerCase() === value.toLowerCase() && w.id !== workspace.id)
  )

  async function saveWorkspaceEdit(): Promise<void> {
    if (!form.nameIsValid()) return
    const { name, folderPath, color } = form.draft
    const result = await updateWorkspace({
      id: workspace.id,
      name: name.trim(),
      folderPath,
      color,
      tags: form.tagList(),
    })
    if (!showSaveError(form, result, 'Failed to update workspace')) onClose()
  }

  return { form, save: saveWorkspaceEdit }
}
