import React, { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { closeAllContextMenus } from '../ContextMenu'
import { useMenuPlacement } from './use-menu-placement'
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
export function NewSessionMenu({ onStartInBranch, onStartScratch }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const placement = useMenuPlacement(open, buttonRef, panelRef)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('close-context-menus', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('close-context-menus', close)
    }
  }, [open])

  const repos = workspaces
    .map((w) => ({ repo: w, branches: projectsByWorkspaceId.get(w.id) ?? [] }))
    .filter((entry) => entry.branches.length > 0)

  function choose(run: () => void): void {
    run()
    setOpen(false)
  }

  return (
    <div className="sidebar-menu home-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className={`sidebar-menu__button${open ? ' sidebar-menu__button--on' : ''}`}
        aria-expanded={open}
        aria-label="New terminal"
        onClick={() => {
          closeAllContextMenus()
          setOpen((v) => !v)
        }}
      >
        <Plus aria-hidden="true" />
        <span className="sidebar-menu__label">New terminal</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="sidebar-menu__panel home-menu__panel"
          role="menu"
          aria-label="Start a terminal"
          style={placement}
        >
          {repos.length === 0 && <div className="sidebar-menu__heading">No branches yet</div>}
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
                  onClick={() => choose(() => onStartInBranch(b.id))}
                >
                  {b.name}
                </button>
              ))}
            </React.Fragment>
          ))}
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
        </div>
      )}
    </div>
  )
}
