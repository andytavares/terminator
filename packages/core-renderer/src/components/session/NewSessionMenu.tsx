import React from 'react'
import { Plus } from 'lucide-react'
import { DropdownMenu } from '../sidebar/menu'
import { useWorkspaceStore } from '../../stores/workspace.store'
import '../sidebar/SidebarMenu.css'

interface Props {
  onStartInBranch: (projectId: string) => void
  onStartScratch: () => void
}

/**
 * Starting work from Home.
 *
 * The sidebar starts a terminal by selecting a branch, which Home has no
 * equivalent of, so the branch is named here instead — every repo's branches,
 * and the scratch terminal that belongs to none of them.
 */
export function NewSessionMenu({ onStartInBranch, onStartScratch }: Props): React.JSX.Element {
  return (
    <DropdownMenu
      label="New terminal"
      icon={<Plus aria-hidden="true" />}
      on="when-open"
      variant="home-menu"
      panelLabel="Start a terminal"
    >
      {(close) => <NewSessionItems {...{ onStartInBranch, onStartScratch, close }} />}
    </DropdownMenu>
  )
}

/** Each branch, then the scratch terminal; picking one closes the menu. */
function NewSessionItems({
  onStartInBranch,
  onStartScratch,
  close,
}: Props & { close: () => void }): React.JSX.Element {
  const choose = (run: () => void): void => {
    run()
    close()
  }
  return (
    <>
      <BranchItems onPick={(id) => choose(() => onStartInBranch(id))} />
      <div className="sidebar-menu__separator" />
      <button
        type="button"
        role="menuitem"
        aria-label="New scratch terminal"
        className="sidebar-menu__item"
        onClick={() => choose(onStartScratch)}
      >
        Scratch terminal
      </button>
    </>
  )
}

/** Every repo that has branches, as a heading over one item per branch. */
function BranchItems({ onPick }: { onPick: (projectId: string) => void }): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  const repos = workspaces
    .map((w) => ({ repo: w, branches: projectsByWorkspaceId.get(w.id) ?? [] }))
    .filter((entry) => entry.branches.length > 0)

  if (repos.length === 0) return <div className="sidebar-menu__heading">No branches yet</div>
  return (
    <>
      {repos.map(({ repo, branches }) => (
        <React.Fragment key={repo.id}>
          <div className="sidebar-menu__heading">{repo.name}</div>
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              aria-label={`New terminal in ${repo.name} / ${b.name}`}
              className="sidebar-menu__item"
              onClick={() => onPick(b.id)}
            >
              {b.name}
            </button>
          ))}
        </React.Fragment>
      ))}
    </>
  )
}
