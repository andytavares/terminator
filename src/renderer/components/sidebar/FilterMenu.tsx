import React, { useEffect, useState } from 'react'
import { ListFilter } from 'lucide-react'
import type { SessionView } from '../../sidebar/view-model'
import { closeAllContextMenus } from '../ContextMenu'
import './SidebarMenu.css'

export interface FilterMenuProps {
  views: SessionView[]
  activeViewId: string
  onSelectView: (id: string) => void
  /** How many branches each view would show, keyed by view id. */
  counts?: Record<string, number>
  onChangeView: (patch: Partial<SessionView>) => void
  /** True when the active view already shows only stale branches. */
  hideStaleUnavailable: boolean
  /** Branches after and before filtering, so the badge can say what is hidden. */
  shown: number
  total: number
  onShowAll: () => void
}

/**
 * Which branches are shown: the saved views and the stale toggle, behind one
 * control.
 *
 * This absorbed the chip strip and the filter-notice band. The notice existed
 * to say "showing 9 of 14" in a strip of its own; a count on the control that
 * caused the filtering says the same thing without a band of chrome, and puts
 * the way out in the same place as the way in.
 */
export function FilterMenu({
  views,
  activeViewId,
  onSelectView,
  counts,
  onChangeView,
  hideStaleUnavailable,
  shown,
  total,
  onShowAll,
}: FilterMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = views.find((v) => v.id === activeViewId) ?? views[0]
  const hidden = Math.max(0, total - shown)

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

  return (
    <div className="sidebar-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`sidebar-menu__button${hidden > 0 ? ' sidebar-menu__button--on' : ''}`}
        aria-expanded={open}
        aria-label={hidden > 0 ? `Filter — ${hidden} hidden` : 'Filter'}
        onClick={() => {
          closeAllContextMenus()
          setOpen((v) => !v)
        }}
      >
        <ListFilter aria-hidden="true" />
        <span className="sidebar-menu__label">Filter</span>
        {hidden > 0 && <span className="sidebar-menu__badge">{hidden}</span>}
      </button>

      {open && (
        <div className="sidebar-menu__panel" role="menu">
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="menuitemradio"
              aria-checked={view.id === activeViewId}
              className={`sidebar-menu__item${view.id === activeViewId ? ' sidebar-menu__item--on' : ''}`}
              onClick={() => {
                onSelectView(view.id)
                setOpen(false)
              }}
            >
              <span>{view.name}</span>
              {counts?.[view.id] ? (
                <span className="sidebar-menu__count">{counts[view.id]}</span>
              ) : null}
            </button>
          ))}

          <div className="sidebar-menu__separator" />

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={active?.filters.hideStale === true}
            className="sidebar-menu__item"
            disabled={hideStaleUnavailable}
            onClick={() =>
              onChangeView({
                filters: { ...active.filters, hideStale: active.filters.hideStale !== true },
              })
            }
          >
            <span>Hide stale</span>
            {active?.filters.hideStale === true && <span className="sidebar-menu__tick">✓</span>}
          </button>

          {hidden > 0 && (
            <>
              <div className="sidebar-menu__separator" />
              <button
                type="button"
                role="menuitem"
                className="sidebar-menu__item sidebar-menu__item--note"
                onClick={() => {
                  onShowAll()
                  setOpen(false)
                }}
              >
                Showing {shown} of {total} — show all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
