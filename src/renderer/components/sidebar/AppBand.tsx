import React from 'react'
import { Square } from 'lucide-react'
import type { GlobalTabRegistration, SidebarButtonRegistration } from '../../extensions/registry'
import './AppBand.css'

export interface AppBandProps {
  globalTabs: GlobalTabRegistration[]
  sidebarItems: SidebarButtonRegistration[]
  activeId: string | null
  onSelect: (id: string) => void
}

/**
 * The sidebar's app-level surfaces, in one labelled band.
 *
 * These used to live at both ends of the sidebar: global tabs as four
 * unlabelled icons at the top, contributed sidebar items as a button strip at
 * the bottom. A user had no way to know why Notes was above and Git Changes
 * below, because the reason was which registration API the extension happened
 * to use — an implementation detail leaking into layout.
 *
 * Both contribution points are unchanged. What changed is only where core draws
 * them. This component names no extension: it renders registry data (Principle
 * II).
 */
export function AppBand({
  globalTabs,
  sidebarItems,
  activeId,
  onSelect,
}: AppBandProps): JSX.Element | null {
  const tabs = globalTabs.filter((t) => !t.hidden)
  if (tabs.length === 0 && sidebarItems.length === 0) return null

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
    </div>
  )
}

function Entry({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  active?: boolean
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
      {/* A contribution without an icon still gets one, so a missing field
          cannot leave a hole in the band. */}
      <span className="app-band__icon" aria-hidden="true">
        {icon ?? <Square />}
      </span>
      <span className="app-band__label">{label}</span>
    </button>
  )
}
