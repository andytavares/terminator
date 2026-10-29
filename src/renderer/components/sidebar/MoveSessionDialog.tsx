import { useShallow } from 'zustand/react/shallow'
import { type JSX, useEffect, useState } from 'react'
import { Dialog, type DialogAction } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { recordUse } from '../../usage/record'
import { SCRATCH_PROJECT_ID, type Project, type Workspace } from '../../../shared/types/index'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import './dialog-fields.css'
import './MoveSessionDialog.css'
import { branchLabel } from '../../sidebar/branch-display'

interface Props {
  sessionId: string
  onClose: () => void
  onMoved?: (targetProjectId: string, targetWorkspaceId: string) => void
}

type SubView = null | { type: 'new-project'; workspaceId: string } | { type: 'new-workspace' }

type MoveTo = (targetProjectId: string, targetWorkspaceId: string) => Promise<void>

export function MoveSessionDialog({ sessionId, onClose, onMoved }: Props): JSX.Element {
  useLoadAllProjects()
  const { currentProjectId, moveSessionTo } = useMoveSession(sessionId, onClose, onMoved)
  const branch = useNewBranch(moveSessionTo)
  const { subView, back, startBranch, newWorkspace } = useSubView(() => branch.edit(''))

  if (subView?.type === 'new-workspace') return <CreateWorkspaceDialog onClose={onClose} />
  const creatingIn = subView?.type === 'new-project' ? subView.workspaceId : null

  return (
    <Dialog
      title="Move to branch"
      onDismiss={onClose}
      actions={creatingIn ? newBranchActions(branch, creatingIn, back) : []}
    >
      <div className="move-session-dialog">
        {creatingIn ? (
          <NewBranchField branch={branch} workspaceId={creatingIn} onBack={back} />
        ) : (
          <BranchList
            {...{ currentProjectId, moveSessionTo, startBranch }}
            onNewWorkspace={newWorkspace}
          />
        )}
      </div>
    </Dialog>
  )
}

/** Which view the dialog shows; starting a branch clears the last one's name first. */
function useSubView(clearBranch: () => void) {
  const [subView, setSubView] = useState<SubView>(null)
  return {
    subView,
    back: (): void => setSubView(null),
    startBranch: (workspaceId: string): void => {
      clearBranch()
      setSubView({ type: 'new-project', workspaceId })
    },
    newWorkspace: (): void => setSubView({ type: 'new-workspace' }),
  }
}

/** Loads the branches of every workspace whose branches are not loaded yet. */
function useLoadAllProjects(): void {
  const { workspaces, projectsByWorkspaceId, loadProjects } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
      loadProjects: s.loadProjects,
    }))
  )
  useEffect(() => {
    for (const ws of workspaces) {
      if (!projectsByWorkspaceId.has(ws.id)) void loadProjects(ws.id)
    }
  }, [workspaces, projectsByWorkspaceId, loadProjects])
}

/** Where the session is, and moving it: the branch it leaves goes if nothing is left there. */
function useMoveSession(sessionId: string, onClose: () => void, onMoved: Props['onMoved']) {
  const currentProjectId = useSessionStore((s) => s.sessions.get(sessionId)?.projectId ?? null)

  const moveSessionTo: MoveTo = async (targetProjectId, targetWorkspaceId) => {
    if (targetProjectId === currentProjectId) return onClose()
    useSessionStore.getState().moveSession(sessionId, targetProjectId)
    recordUse('core.sidebar.move-session')
    if (currentProjectId) await deleteIfEmpty(currentProjectId)
    const workspaces = useWorkspaceStore.getState()
    workspaces.setActiveWorkspace(targetWorkspaceId)
    workspaces.setActiveProject(targetProjectId)
    onMoved?.(targetProjectId, targetWorkspaceId)
    onClose()
  }

  return { currentProjectId, moveSessionTo }
}

/** Deletes a branch nothing is open in any more; never the scratch one. */
async function deleteIfEmpty(projectId: string): Promise<void> {
  if (projectId === SCRATCH_PROJECT_ID) return
  if (useSessionStore.getState().getSessionsForProject(projectId).length > 0) return
  await useWorkspaceStore.getState().deleteProject(projectId)
}

/** The new branch's name, its error, and creating it then moving the session into it. */
function useNewBranch(moveSessionTo: MoveTo) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function createAndMove(workspaceId: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return setError('Name is required')
    setLoading(true)
    setError('')
    const result = await useWorkspaceStore.getState().createProject({ workspaceId, name: trimmed })
    setLoading(false)
    if (!('error' in result)) return moveSessionTo(result.project.id, workspaceId)
    setError(
      result.error === 'DUPLICATE_NAME' ? 'Name already in use' : 'Could not create the branch'
    )
  }

  const editName = (value: string): void => {
    setName(value)
    setError('')
  }

  return { name, error, loading, create: createAndMove, edit: editName }
}

type NewBranch = ReturnType<typeof useNewBranch>

function newBranchActions(
  branch: NewBranch,
  workspaceId: string,
  back: () => void
): DialogAction[] {
  return [
    { label: 'Back', onSelect: back },
    {
      label: 'Create & move',
      tone: 'primary',
      disabled: branch.loading,
      onSelect: () => branch.create(workspaceId),
    },
  ]
}

interface NewBranchFieldProps {
  branch: NewBranch
  workspaceId: string
  onBack: () => void
}

/** The new branch's name; Enter creates it, Escape goes back to the list. */
function NewBranchField({ branch, workspaceId, onBack }: NewBranchFieldProps): JSX.Element {
  return (
    <div className="move-session-dialog__new-project">
      <div className="dialog__field">
        <label className="dialog__label">Branch name</label>
        <input
          className={`dialog__input${branch.error ? ' dialog__input--error' : ''}`}
          value={branch.name}
          onChange={(e) => branch.edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void branch.create(workspaceId)
            if (e.key === 'Escape') {
              // Escape leaves the sub-view; it must not also close the dialog.
              e.stopPropagation()
              onBack()
            }
          }}
          placeholder="My branch"
          autoFocus
        />
        {branch.error && <span className="dialog__error">{branch.error}</span>}
      </div>
    </div>
  )
}

interface BranchListProps {
  currentProjectId: string | null
  moveSessionTo: MoveTo
  startBranch: (workspaceId: string) => void
  onNewWorkspace: () => void
}

/** Every workspace's branches to move to, then a way to start a new workspace. */
function BranchList({ onNewWorkspace, ...choices }: BranchListProps): JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  return (
    <>
      <div className="move-session-dialog__list">
        {workspaces.map((ws) => (
          <WorkspaceBranches key={ws.id} workspace={ws} {...choices} />
        ))}
      </div>
      <div className="move-session-dialog__footer">
        <button
          className="move-session-dialog__new-btn move-session-dialog__new-workspace-btn"
          onClick={onNewWorkspace}
        >
          + New workspace
        </button>
      </div>
    </>
  )
}

type WorkspaceBranchesProps = Omit<BranchListProps, 'onNewWorkspace'> & { workspace: Workspace }

/** One workspace's heading, its branches (the current one marked and disabled), and New branch. */
function WorkspaceBranches({
  workspace: ws,
  currentProjectId,
  moveSessionTo,
  startBranch,
}: WorkspaceBranchesProps): JSX.Element {
  const projects = useWorkspaceStore((s) => s.projectsByWorkspaceId.get(ws.id)) ?? []
  return (
    <div className="move-session-dialog__workspace">
      <div
        className="move-session-dialog__ws-header"
        style={{ ['--ws-color' as string]: ws.color }}
      >
        <span className="move-session-dialog__ws-dot" style={{ background: ws.color }} />
        {ws.name}
      </div>
      {projects.map((project) => (
        <BranchButton
          key={project.id}
          project={project}
          current={project.id === currentProjectId}
          onSelect={() => void moveSessionTo(project.id, ws.id)}
        />
      ))}
      <button className="move-session-dialog__new-btn" onClick={() => startBranch(ws.id)}>
        + New branch in {ws.name}
      </button>
    </div>
  )
}

interface BranchButtonProps {
  project: Project
  current: boolean
  onSelect: () => void
}

/** One branch to move to; the session's own branch is marked current and disabled. */
function BranchButton({ project, current, onSelect }: BranchButtonProps): JSX.Element {
  return (
    <button
      className={`move-session-dialog__project${current ? ' move-session-dialog__project--current' : ''}`}
      onClick={onSelect}
      disabled={current}
    >
      {branchLabel(project)}
      {current && <span className="move-session-dialog__current-label">current</span>}
    </button>
  )
}
