import React, { Suspense, lazy, useEffect } from 'react'
import { PulseLine } from './PulseLine'
import { PlanStrip } from './PlanStrip'
import { NeedsYou } from './NeedsYou'
import { TaskList } from './TaskList'
import { HomeFooter } from './HomeFooter'
import { useDeskFilter } from './desk-filter'
import { usePlanSheet } from './plan-sheet'
import type { DeskController } from './use-desk-controller'
import type { DeskState } from './useDeskModel'
import './TasksBody.css'

const PlanSheet = lazy(() => import('./PlanSheet').then((m) => ({ default: m.PlanSheet })))

export interface TasksBodyProps {
  desk: DeskState & { searching: boolean }
  controller: DeskController
}

/** Closing Home closes the sheet; P pressed on the Classic layout must not leave it waiting. */
function useSheetOpen(): boolean {
  const open = usePlanSheet((s) => s.open)
  useEffect(() => () => usePlanSheet.getState().hide(), [])
  return open
}

/** Home's Tasks layout: the pulse, the plan strip, what needs you, then the tasks in a fixed order. */
export function TasksBody({ desk, controller }: TasksBodyProps): React.JSX.Element {
  const pressed = useDeskFilter((s) => s.taskState)
  const sheetOpen = useSheetOpen()
  const showQueue = pressed === null || pressed === 'needs-you'
  const quietWhileSearching = desk.asks.length === 0 && desk.searching
  return (
    <div className="desk__body tasks-body">
      <PulseLine desk={desk} />
      <PlanStrip now={desk.now} />
      {showQueue && !quietWhileSearching && (
        <NeedsYou desk={desk} cursor={controller.cursor} handlers={controller.handlers} />
      )}
      {pressed !== 'needs-you' && <TaskList />}
      <HomeFooter />
      {sheetOpen && (
        <Suspense fallback={null}>
          <PlanSheet now={desk.now} />
        </Suspense>
      )}
    </div>
  )
}
