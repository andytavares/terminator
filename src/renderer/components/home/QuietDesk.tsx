import React from 'react'
import { CircleCheck } from 'lucide-react'
import { Button, Kbd } from '@terminator/extension-ui'
import { useStartWorkStore } from './start-work'
import type { DeskState } from './useDeskAsks'
import './YourMove.css'

/** What replaces the band when nothing waits on the operator. */
export function QuietDesk({
  desk,
}: {
  desk: Pick<DeskState, 'counts' | 'doneToday'>
}): JSX.Element {
  const working = desk.counts.agentsWorking
  return (
    <div className="quiet">
      <CircleCheck aria-hidden="true" className="quiet__icon" />
      <span>
        <b>Nothing needs you.</b>{' '}
        {working > 0 && `${working} ${working === 1 ? 'agent is' : 'agents are'} working. `}
        Done today: {desk.doneToday}.
      </span>
      <Button size="sm" onClick={() => useStartWorkStore.getState().openLauncher()}>
        Start work <Kbd>⌘N</Kbd>
      </Button>
    </div>
  )
}
