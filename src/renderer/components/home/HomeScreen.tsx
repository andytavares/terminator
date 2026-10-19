import React, { useEffect, useMemo, useRef } from 'react'
import { DeskHeader } from './DeskHeader'
import { SummaryLine } from './SummaryLine'
import { askMatches, useDeskFilter } from './desk-filter'
import { PlanTheDay } from './PlanTheDay'
import { YourMove } from './YourMove'
import { QuietDesk } from './QuietDesk'
import { InFlight } from './InFlight'
import { TodayRail } from './TodayRail'
import { Insights } from './Insights'
import { useHomeView } from './home-view'
import { useDeskModel, type DeskState } from './useDeskModel'
import { useDeskController, type DeskController } from './use-desk-controller'
import { useDeskKeys } from './use-desk-keys'
import { useMarkLeftHome } from './use-mark-left-home'
import { useOpenRequestedResume } from './desk-selection'
import './HomeScreen.css'

export interface HomeScreenProps {
  /** Quick actions is ⌘P everywhere now; the Desk draws no button for it. */
  onOpenQuickActions?: () => void
}

/**
 * The launch view: what waits on you, what is in flight, and today.
 *
 * Single-letter keys act while focus is inside this section and never in a field or a terminal.
 */
export function HomeScreen(_props: HomeScreenProps = {}): JSX.Element {
  const desk = useShownAsks(useDeskModel())
  const view = useHomeView((s) => s.view)
  const rootRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const controller = useDeskController(desk)
  const onKeyDown = useRootKeys(controller, searchRef)
  useOpenRequestedResume()
  useMarkLeftHome()

  useEffect(() => rootRef.current?.focus({ preventScroll: true }), [])

  return (
    <section className="desk" aria-label="Home" tabIndex={-1} ref={rootRef} onKeyDown={onKeyDown}>
      <DeskHeader ref={searchRef} now={desk.now} />
      {view === 'insights' ? <Insights /> : <DeskBody desk={desk} controller={controller} />}
    </section>
  )
}

/** ⌘K goes to the search field; the Desk's own keys are read after it. */
function useRootKeys(
  controller: DeskController,
  searchRef: React.RefObject<HTMLInputElement | null>
) {
  const onDeskKey = useDeskKeys(controller.onCommand)
  return (event: React.KeyboardEvent): void => {
    if (event.metaKey && event.key === 'k') {
      event.preventDefault()
      event.stopPropagation()
      searchRef.current?.focus()
      return
    }
    onDeskKey(event)
  }
}

type ShownDesk = DeskState & { searching: boolean }

interface DeskBodyProps {
  desk: ShownDesk
  controller: DeskController
}

/** Everything under the header on the Desk. A pressed count narrows it to the band or to In flight. */
function DeskBody(props: DeskBodyProps): JSX.Element {
  const { desk, controller } = props
  const filter = useDeskFilter((s) => s.count)
  const showBand = filter === null || filter === 'your-move'
  const showLower = filter !== 'your-move'
  return (
    <div className="desk__body">
      <SummaryLine desk={desk} />
      <PlanTheDay />
      {showBand && <Band desk={desk} controller={controller} />}
      {showLower && (
        <div className="desk-lower">
          <InFlight />
          <TodayRail />
        </div>
      )}
    </div>
  )
}

/** The asks that match the search text; counts and the badge keep counting all of them. */
function useShownAsks(desk: DeskState): DeskState & { searching: boolean } {
  const text = useDeskFilter((s) => s.text)
  return useMemo(
    () => ({
      ...desk,
      asks: desk.asks.filter((ask) => askMatches(ask, text)),
      searching: text.trim() !== '',
    }),
    [desk, text]
  )
}

function Band({
  desk,
  controller,
}: Pick<DeskBodyProps, 'controller'> & { desk: ShownDesk }): JSX.Element | null {
  if (desk.asks.length === 0) return desk.searching ? null : <QuietDesk desk={desk} />
  return <YourMove desk={desk} cursor={controller.cursor} handlers={controller.handlers} />
}
