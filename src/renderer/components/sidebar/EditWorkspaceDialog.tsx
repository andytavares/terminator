import { useShallow } from 'zustand/react/shallow'
import { Dialog } from '@terminator/extension-ui'
import type { Workspace } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useModalEffect } from '../../stores/modal.store'
import { DUPLICATE_NAME, WorkspaceFields, useWorkspaceForm } from './workspace-form'

interface Props {
  workspace: Workspace
  onClose: () => void
}

export function EditWorkspaceDialog({ workspace, onClose }: Props): JSX.Element {
  useModalEffect()
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

  async function handleSubmit(): Promise<void> {
    if (!form.nameIsValid()) return
    const { name, folderPath, color } = form.draft
    const result = await updateWorkspace({
      id: workspace.id,
      name: name.trim(),
      folderPath,
      color,
      tags: form.tagList(),
    })
    if ('error' in result) {
      if (result.error === 'DUPLICATE_NAME') form.setNameError(DUPLICATE_NAME)
      else form.setError('Failed to update workspace')
      return
    }
    onClose()
  }

  return (
    <Dialog
      title="Edit Workspace"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        {
          label: 'Save',
          tone: 'primary',
          submit: true,
          disabled: !!form.nameError,
          onSelect: handleSubmit,
        },
      ]}
    >
      <WorkspaceFields form={form} />
    </Dialog>
  )
}
