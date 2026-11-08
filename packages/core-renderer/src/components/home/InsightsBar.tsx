import React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, SegmentedControl } from '@terminator/extension-ui'
import { INSIGHTS_WINDOWS } from '../../home/insights'
import { useInsightsWindow } from './insights-window'

/** The time window and the repo filter; Home's header shows them in place of search and Start work. */
export function InsightsBar(): React.JSX.Element {
  const chosen = useInsightsWindow((s) => s.chosen)
  const onChange = useInsightsWindow((s) => s.choose)
  return (
    <div className="ins__bar">
      <SegmentedControl
        label="Time window"
        size="sm"
        options={INSIGHTS_WINDOWS}
        value={chosen}
        onChange={onChange}
      />
      <Button variant="ghost" size="sm" disabled title="Filtering by repo is not available yet">
        All repos <ChevronDown aria-hidden="true" />
      </Button>
    </div>
  )
}
