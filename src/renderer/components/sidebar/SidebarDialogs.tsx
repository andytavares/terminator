import { lazy, Suspense, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Workspace } from '../../../shared/types/index'
import type { SessionFacts } from '../../sidebar/session-facts'
import { branchLabel, qualifiedBranchLabel } from '../../sidebar/branch-display'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { ConfirmDialog } from '../ConfirmDialog'
import { LinkIssueDialog } from '../integrations/LinkIssueDialog'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import type { SidebarData } from './useSidebarRows'

const IssueDrawer = lazy(() =>
  import('../integrations/IssueDrawer').then((m) => ({ default: m.IssueDrawer }))
)

/** The one dialog the sidebar has open, if any. */
export type SidebarDialog =
  | { kind: 'link-session'; sessionId: string }
  | { kind: 'create-workspace' }
  | { kind: 'edit-workspace'; workspace: Workspace }
  | { kind: 'remove-workspace'; workspace: Workspace }
  | { kind: 'create-branch'; workspaceId: string }
  | { kind: 'remove-branch'; projectId: string; name: string }

/** Which sidebar dialog is open, and opening or closing it. */
export function useSidebarDialog() {
  const [dialog, setDialog] = useState<SidebarDialog | null>(null)
  return { dialog, open: setDialog, close: () => setDialog(null) }
}

interface SidebarDialogsProps {
  dialog: SidebarDialog | null
  close: () => void
  factsBySessionId: Map<string, SessionFacts>
}

/** The open sidebar dialog: a session link, a workspace or branch to create, edit or remove. */
export function SidebarDialogs({ dialog, close, factsBySessionId }: SidebarDialogsProps) {
  switch (dialog?.kind) {
    case 'link-session': {
      const facts = factsBySessionId.get(dialog.sessionId)
      return facts ? <SessionLinkDialog facts={facts} onClose={close} /> : null
    }
    case 'create-workspace':
      return <CreateWorkspaceDialog onClose={close} />
    case 'edit-workspace':
      return <EditWorkspaceDialog workspace={dialog.workspace} onClose={close} />
    case 'remove-workspace':
      return <ConfirmRemoval {...removeWorkspace(dialog.workspace)} close={close} />
    case 'create-branch':
      return <CreateProjectDialog workspaceId={dialog.workspaceId} onClose={close} />
    case 'remove-branch':
      return <ConfirmRemoval {...removeBranch(dialog.projectId, dialog.name)} close={close} />
    default:
      return null
  }
}

interface Removal {
  title: string
  remove: () => void
}

function removeWorkspace(workspace: Workspace): Removal {
  return {
    title: `Remove workspace "${workspace.name}"?`,
    remove: () => void useWorkspaceStore.getState().deleteWorkspace(workspace.id),
  }
}

function removeBranch(projectId: string, name: string): Removal {
  return {
    title: `Remove branch "${name}"?`,
    remove: () => void useWorkspaceStore.getState().deleteProject(projectId),
  }
}

function ConfirmRemoval({ title, remove, close }: Removal & { close: () => void }): JSX.Element {
  return (
    <ConfirmDialog
      title={title}
      confirmLabel="Remove"
      danger
      onConfirm={() => {
        remove()
        close()
      }}
      onClose={close}
    />
  )
}

/** The issue link dialog and the issue drawer, each open on a branch the sidebar lists. */
export function IssueDialogs(data: SidebarData): JSX.Element {
  return (
    <>
      <LinkIssueHost {...data} />
      <IssueDrawerHost {...data} />
    </>
  )
}

function LinkIssueHost({ projectById, workspaceById }: SidebarData) {
  const { projectId, close, currentKey } = useIntegrationsStore(
    useShallow((s) => ({
      projectId: s.linkDialogProjectId,
      close: s.closeLinkDialog,
      currentKey:
        s.linkDialogProjectId === null ? null : (s.linkFor(s.linkDialogProjectId)?.key ?? null),
    }))
  )
  const project = projectId === null ? undefined : projectById.get(projectId)
  if (!project) return null
  return (
    <LinkIssueDialog
      projectId={project.id}
      // Qualified: "Attaching to main" named one of six identical things.
      projectName={qualifiedBranchLabel(project, workspaceById.get(project.workspaceId)?.name)}
      currentKey={currentKey}
      onClose={close}
    />
  )
}

function IssueDrawerHost({ projectById }: SidebarData) {
  const { projectId, close } = useIntegrationsStore(
    useShallow((s) => ({ projectId: s.drawerProjectId, close: s.closeDrawer }))
  )
  const project = projectId === null ? undefined : projectById.get(projectId)
  if (!project) return null
  return (
    <div className="issue-drawer-host">
      <Suspense fallback={null}>
        <IssueDrawer projectId={project.id} projectName={branchLabel(project)} onClose={close} />
      </Suspense>
    </div>
  )
}
