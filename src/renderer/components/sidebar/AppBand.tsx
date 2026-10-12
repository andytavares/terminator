import React from 'react'
import { Bell, Command, Puzzle } from 'lucide-react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import './AppBand.css'

export interface AppBandProps {
  globalTabs: GlobalTabRegistration[]
  activeId: string | null
  onSelect: (id: string) => void
  /** The notification bell, which is app-level like everything else here. */
  unreadNotifications?: number
  onBellClick?: () => void
  onOpenQuickActions?: () => void
}

/**
 * The sidebar's app-level surfaces, in one compact row of icons.
 *
 * The 8px text label under each icon became an accessible name and a tooltip,
 * which is what an icon strip at this size can actually carry. This component
 * names no extension: it renders registry data (Principle II).
 */
export function AppBand({
  globalTabs,
  activeId,
  onSelect,
  unreadNotifications = 0,
  onBellClick,
  onOpenQuickActions,
}: AppBandProps): JSX.Element | null {
  const tabs = globalTabs.filter((t) => !t.hidden)
  if (tabs.length === 0 && onBellClick === undefined && onOpenQuickActions === undefined)
    return null

  return (
    <div className="app-band">
      {tabs.map((tab) => (
        <Entry
          key={tab.id}
          label={
            (tab.badge ?? 0) > 0 && tab.badgeLabel ? `${tab.label}, ${tab.badgeLabel}` : tab.label
          }
          icon={tab.icon}
          active={activeId === tab.id}
          badge={tab.badge}
          onClick={() => onSelect(tab.id)}
        />
      ))}
      {(onOpenQuickActions || onBellClick) && <span className="app-band__spacer" />}
      {onOpenQuickActions && (
        <Entry label="Quick actions (⌘P)" icon={<Command />} onClick={onOpenQuickActions} />
      )}
      {onBellClick && (
        <Entry
          label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ''}`}
          icon={<Bell />}
          badge={unreadNotifications}
          onClick={onBellClick}
        />
      )}
    </div>
  )
}

function Entry({
  label,
  icon,
  active,
  badge = 0,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  active?: boolean
  badge?: number
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={`app-band__entry${active ? ' app-band__entry--active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(active ? { 'aria-current': 'page' as const } : {})}
    >
      {/* Puzzle is the last resort for a tab that names no icon: it at least reads
          as "an extension", which a bare square did not. */}
      <span className="app-band__icon" aria-hidden="true">
        {icon ?? <Puzzle />}
      </span>
      {badge > 0 && <span className="app-band__badge">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )
}
