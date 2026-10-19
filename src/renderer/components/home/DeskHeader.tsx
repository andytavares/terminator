import React, { forwardRef } from 'react'
import { Plus } from 'lucide-react'
import { Button, Kbd, SegmentedControl } from '@terminator/extension-ui'
import { DeskSearch } from './DeskSearch'
import { useStartWorkStore } from './start-work'
import { useHomeView, type HomeViewName } from './home-view'
import { InsightsBar } from './InsightsBar'

const VIEWS = [
  { value: 'desk', label: 'Desk' },
  { value: 'insights', label: 'Insights' },
] as const

/** "Saturday 18 October". */
function deskDate(now: number): string {
  const day = new Date(now)
  const formatPart = (options: Intl.DateTimeFormatOptions): string =>
    day.toLocaleDateString('en-GB', options)
  return `${formatPart({ weekday: 'long' })} ${formatPart({ day: 'numeric' })} ${formatPart({ month: 'long' })}`
}

const openStartWork = (): void => useStartWorkStore.getState().openLauncher()

/** Search and Start work on the Desk; the time window and repo filter on Insights. */
const DeskHeaderTools = forwardRef<HTMLInputElement, { view: HomeViewName }>(
  function DeskHeaderTools({ view }, searchRef) {
    if (view === 'insights') return <InsightsBar />
    return (
      <>
        <DeskSearch ref={searchRef} />
        <Button variant="primary" icon={Plus} className="hd__start" onClick={openStartWork}>
          Start work <Kbd>⌘N</Kbd>
        </Button>
      </>
    )
  }
)

/** Home's title and date, the Desk | Insights switch, and the view's own tools. */
export const DeskHeader = forwardRef<HTMLInputElement, { now: number }>(function DeskHeader(
  { now },
  searchRef
) {
  const view = useHomeView((s) => s.view)
  const show = useHomeView((s) => s.show)
  return (
    <header className="hd">
      <h1 className="hd__title">Home</h1>
      <span className="hd__date">{deskDate(now)}</span>
      <SegmentedControl<HomeViewName>
        label="View"
        options={VIEWS}
        value={view}
        onChange={show}
        size="sm"
      />
      <span className="hd__spacer" />
      <DeskHeaderTools view={view} ref={searchRef} />
    </header>
  )
})
