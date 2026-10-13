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
          label={entryLabel(tab)}
          icon={tab.icon}
          active={activeId === tab.id}
          badge={tab.badge}
          onClick={() => onSelect(tab.id)}
        />
      ))}
      <AppEntries {...{ unreadNotifications, onBellClick, onOpenQuickActions }} />
    </div>
  )
}

/** Quick Actions and the bell, set apart at the end of the row. */
function AppEntries({
  unreadNotifications = 0,
  onBellClick,
  onOpenQuickActions,
}: Pick<AppBandProps, 'unreadNotifications' | 'onBellClick' | 'onOpenQuickActions'>) {
  return (
    <>
      {(onOpenQuickActions || onBellClick) && <span className="app-band__spacer" />}
      {onOpenQuickActions && (
        <Entry label="Quick actions (⌘P)" icon={<Command />} onClick={onOpenQuickActions} />
      )}
      {onBellClick && <BellEntry unread={unreadNotifications} onClick={onBellClick} />}
    </>
  )
}

/** A tab's name, and while it is badged what the badge counts. */
function entryLabel(tab: GlobalTabRegistration): string {
  return (tab.badge ?? 0) > 0 && tab.badgeLabel ? `${tab.label}, ${tab.badgeLabel}` : tab.label
}

function BellEntry({ unread, onClick }: { unread: number; onClick: () => void }): JSX.Element {
  return (
    <Entry
      label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      icon={<Bell />}
      badge={unread}
      onClick={onClick}
    />
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
