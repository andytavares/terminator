import React from 'react'
import { plural } from '@terminator/extension-sdk/plain'
import { Button, Kbd } from '@terminator/extension-ui'
import { FOCUS_LIMIT, localDateKey } from '../../home/focus'
import { useFocusStore } from '../../home/focus-store'
import { usePlan } from './usePlan'
import { usePlanSheet } from './plan-sheet'

/** One line instead of a panel: hidden once today's plan is started or skipped. */
export function PlanStrip({ now }: { now: number }): JSX.Element | null {
  const dismissedOn = useFocusStore((s) => s.planDismissedOn)
  const dismissPlan = useFocusStore((s) => s.dismissPlan)
  const carried = usePlan(now).carried.length
  if (dismissedOn === localDateKey(now)) return null
  return (
    <div className="plan-strip">
      <span>
        <b>Plan today</b> · {carried} {plural(carried, 'task')} carried over · pick up to{' '}
        {FOCUS_LIMIT} to focus on
      </span>
      <span className="plan-strip__actions">
        <Button size="sm" onClick={() => usePlanSheet.getState().show()}>
          Plan <Kbd>P</Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissPlan(Date.now())}>
          Skip today
        </Button>
      </span>
    </div>
  )
}
