import React from 'react'
import { Bell, Puzzle } from 'lucide-react'
import type { GlobalTabRegistration, SidebarButtonRegistration } from '../../extensions/registry'
import './AppBand.css'

export interface AppBandProps {
  globalTabs: GlobalTabRegistration[]
  sidebarItems: SidebarButtonRegistration[]
  activeId: string | null
  onSelect: (id: string) => void
  /** The notification bell, which is app-level like everything else here. */
  unreadNotifications?: number
  onBellClick?: () => void
}

/**
 * The sidebar's app-level surfaces, in one compact row of icons.
 *
 * These used to live at both ends of the sidebar: global tabs as four
 * unlabelled icons at the top, contributed sidebar items as a button strip at
 * the bottom. A user had no way to know why Notes was above and Git Changes
 * below, because the reason was which registration API the extension happened
 * to use — an implementation detail leaking into layout.
 *
 * Both contribution points are unchanged. What changed is only where core draws
 * them, and how densely: the 8px text label under each icon became an
 * accessible name and a tooltip, which is what an icon strip at this size can
 * actually carry. This component names no extension: it renders registry data
 * (Principle II).
 */
export function AppBand({
  globalTabs,
  sidebarItems,
  activeId,
  onSelect,
  unreadNotifications = 0,
  onBellClick,
}: AppBandProps): JSX.Element | null {
  const tabs = globalTabs.filter((t) => !t.hidden)
  if (tabs.length === 0 && sidebarItems.length === 0 && onBellClick === undefined) return null

  return (
    <div className="app-band">
      {tabs.map((tab) => (
        <Entry
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          active={activeId === tab.id}
          onClick={() => onSelect(tab.id)}
        />
      ))}
      {sidebarItems.map((item) => (
        <Entry key={item.id} label={item.label} icon={item.icon} onClick={item.action} />
      ))}
      {onBellClick && (
        <>
          <span className="app-band__spacer" />
          <Entry
            label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ''}`}
            icon={<Bell />}
            badge={unreadNotifications}
            onClick={onBellClick}
          />
        </>
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
      {/* Every contribution should name an icon — `SidebarContribution.icon`
          takes the same lucide names a manifest uses. Puzzle is the last
          resort for one that names none: it at least reads as "an extension",
          which a bare square did not. */}
      <span className="app-band__icon" aria-hidden="true">
        {icon ?? <Puzzle />}
      </span>
      {badge > 0 && <span className="app-band__badge">{badge > 9 ? '9+' : badge}</span>}
    </button>
  )
}
