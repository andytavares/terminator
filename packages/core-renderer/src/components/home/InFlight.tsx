import React, { Suspense, lazy } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { StatusDot } from '@terminator/extension-ui'
import { DeskGroupMenu } from './DeskGroupMenu'
import { useNow } from '../session/useNow'
import { InFlightRow } from './InFlightRow'
import { useDeskSelection, useShownRows } from './desk-selection'
import { useWorkThreads } from './useWorkThreads'
import { deskGroups, filterThreads, type DeskGroup } from './desk-groups'
import { useDeskFilter } from './desk-filter'
import '../sidebar/SidebarMenu.css'

const ThreadDrawer = lazy(() => import('./ThreadDrawer').then((m) => ({ default: m.ThreadDrawer })))
import './InFlight.css'

const MINUTE_MS = 60_000

function GroupHeading({ group }: { group: DeskGroup }): React.JSX.Element {
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

function GroupRows({ group, now }: { group: DeskGroup; now: number }): React.JSX.Element {
  const { selectedKey, threads } = useShownRows(group)
  return (
    <>
      {threads.map((thread) => (
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

function InFlightHeader({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="desk-sec-h">
      <h5>In flight</h5>
      <span>
        {count} work {count === 1 ? 'item' : 'items'}
      </span>
      <span className="desk-sec-h__right">
        <DeskGroupMenu />
      </span>
    </div>
  )
}

/** The drawer of the thread that is open; its code loads the first time one opens. */
function OpenThreadDrawer(): React.JSX.Element | null {
  const openThreadKey = useDeskSelection((s) => s.openThreadKey)
  if (openThreadKey === null) return null
  return (
    <Suspense fallback={null}>
      <ThreadDrawer />
    </Suspense>
  )
}

/** The Desk's list of work, grouped by whose move it is, with the drawer of the one that is open. */
export function InFlight(): React.JSX.Element {
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
      <OpenThreadDrawer />
    </section>
  )
}
