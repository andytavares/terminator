import React from 'react'
import { Dialog } from '@terminator/extension-ui'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useFocusStore } from '../../home/focus-store'
import { FOCUS_LIMIT } from '../../home/focus'
import { runningSentence } from '../../home/plan-the-day'
import { CarriedOverColumn } from './PlanTheDay'
import { PlanTaskFocus } from './PlanTaskFocus'
import { TicketsColumn } from './TicketsColumn'
import { usePlan } from './usePlan'
import { usePlanSheet } from './plan-sheet'
import { useWorkThreads } from './useWorkThreads'
import './PlanTheDay.css'

/** The three parts, side by side; a part with nothing to show is left out. */
function PlanSheetBody({ now }: { now: number }): JSX.Element {
  const plan = usePlan(now)
  const { threads } = useWorkThreads()
  const hasTracker = useIntegrationsStore((s) => s.connections.some((c) => c.connected))
  const running = runningSentence(threads)
  return (
    <div className="plan-sheet">
      <p className="plan-sheet__line">{plan.sentence}</p>
      <div className="plan__body plan-sheet__body">
        {plan.carried.length > 0 && (
          <CarriedOverColumn rows={plan.carried} full={plan.today.length >= FOCUS_LIMIT} />
        )}
        {hasTracker && <TicketsColumn />}
        <PlanTaskFocus threads={threads} now={now} />
      </div>
      {running && <p className="plan-sheet__line">{running}</p>}
      {!hasTracker && (
        <p className="plan-sheet__line plan-sheet__line--faint">
          Connect Linear in Settings → Integrations to plan from your tickets.
        </p>
      )}
    </div>
  )
}

/** Plan today as a sheet over Home; Skip today and Start the day both end the day's planning. */
export function PlanSheet({ now }: { now: number }): JSX.Element {
  const dismissPlan = useFocusStore((s) => s.dismissPlan)
  const hide = usePlanSheet((s) => s.hide)
  const finish = (): void => {
    dismissPlan(Date.now())
    hide()
  }
  return (
    <Dialog
      title="Plan today"
      size="wide"
      onDismiss={hide}
      actions={[
        { label: 'Skip today', onSelect: finish },
        { label: 'Start the day', tone: 'primary', onSelect: finish },
      ]}
    >
      <PlanSheetBody now={now} />
    </Dialog>
  )
}
