import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { StatusDot } from '@terminator/extension-ui'
import { DropdownMenu, RadioChoices } from '../sidebar/menu'
import { useNow } from '../session/useNow'
import { InFlightRow } from './InFlightRow'
import { ThreadDrawer } from './ThreadDrawer'
import { useDeskSelection } from './desk-selection'
import { useWorkThreads } from './useWorkThreads'
import { DESK_GROUP_OPTIONS, deskGroups, filterThreads, type DeskGroup } from './desk-groups'
import { useDeskFilter } from './desk-filter'
import '../sidebar/SidebarMenu.css'
import './InFlight.css'

const MINUTE_MS = 60_000

function GroupMenu(): JSX.Element {
  const groupBy = useDeskSelection((s) => s.groupBy)
  const setGroupBy = useDeskSelection((s) => s.setGroupBy)
  const current = DESK_GROUP_OPTIONS.find(([value]) => value === groupBy)?.[1]
  return (
    <DropdownMenu
      label={`Group: ${current}`}
      icon={<ChevronDown aria-hidden="true" />}
      panelLabel="Group by"
      variant="desk-group-menu"
    >
      {(close) => (
        <RadioChoices
          choices={DESK_GROUP_OPTIONS}
          current={groupBy}
          onPick={(value) => {
            setGroupBy(value)
            close()
          }}
        />
      )}
    </DropdownMenu>
  )
}

function GroupHeading({ group }: { group: DeskGroup }): JSX.Element {
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  const toggleGroup = useDeskSelection((s) => s.toggleGroup)
  if (!group.collapsible) {
    return (
      <div className="desk-grp">
        <StatusDot tone={group.tone} />
        {group.label} · {group.threads.length}
      </div>
    )
  }
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      className="desk-grp desk-grp--collapsible"
      aria-expanded={expanded}
      onClick={() => toggleGroup(group.id)}
    >
      <Chevron aria-hidden="true" />
      {group.label} · {group.threads.length} · {group.note}
    </button>
  )
}

function GroupRows({ group, now }: { group: DeskGroup; now: number }): JSX.Element | null {
  const selectedKey = useDeskSelection((s) => s.selectedThreadKey)
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  if (group.collapsible && !expanded) return null
  return (
    <>
      {group.threads.map((thread) => (
        <InFlightRow
          key={thread.key}
          thread={thread}
          now={now}
          selected={thread.key === selectedKey}
        />
      ))}
    </>
  )
}

function InFlightHeader({ count }: { count: number }): JSX.Element {
  return (
    <div className="desk-sec-h">
      <h5>In flight</h5>
      <span>
        {count} work {count === 1 ? 'item' : 'items'}
      </span>
      <span className="desk-sec-h__right">
        <GroupMenu />
      </span>
    </div>
  )
}

/** The Desk's list of work, grouped by whose move it is, with the drawer of the one that is open. */
export function InFlight(): JSX.Element {
  const { threads } = useWorkThreads()
  const groupBy = useDeskSelection((s) => s.groupBy)
  const now = useNow(MINUTE_MS)
  const { text, count } = useDeskFilter()
  const shown = filterThreads(threads, { text, count })
  return (
    <section aria-label="In flight">
      <InFlightHeader count={shown.length} />
      <div className="desk-th">
        <span>Work</span>
        <span>Stage</span>
        <span>Agents</span>
        <span>Pull request</span>
        <span className="desk-th__last">Last</span>
      </div>
      {deskGroups(shown, groupBy).map((group) => (
        <React.Fragment key={group.id}>
          <GroupHeading group={group} />
          <GroupRows group={group} now={now} />
        </React.Fragment>
      ))}
      <ThreadDrawer />
    </section>
  )
}
