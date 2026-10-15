import React, { useRef } from 'react'
import { X } from 'lucide-react'
import {
  IconButton,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
  useDismissible,
} from '@terminator/extension-ui'
import type { RiskScore } from '../../schemas/pr-review.schema'
import { WhyThisFile } from './WhyThisFile'
import './review-inspector.css'

export type InspectorTab = 'agent' | 'file'

export interface ReviewInspectorProps {
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  onClose: () => void
  agentAvailable: boolean
  agentFindingCount: number
  agent: React.ReactNode
  file: {
    path: string
    riskScore: RiskScore
    repoRoot: string
  } | null
}

type InspectorFile = NonNullable<ReviewInspectorProps['file']>

/** The tab to show: the asked-for one unless it has nothing to show. */
function resolveTab(props: ReviewInspectorProps): InspectorTab {
  if (props.tab === 'agent' && props.agentAvailable) return 'agent'
  if (props.file != null) return 'file'
  return 'agent'
}

function agentTabName(count: number): string | undefined {
  if (count > 0) return `Agent, ${count}`
  return undefined
}

function InspectorTabs({ inspector: props }: { inspector: ReviewInspectorProps }) {
  const count = props.agentFindingCount
  return (
    <div className="ri-header">
      <TabList label="Inspector" className="ri-tablist">
        {props.agentAvailable && (
          <Tab id="agent" accessibleName={agentTabName(count)}>
            Agent
            {count > 0 && <span className="ri-tab-badge">{count}</span>}
          </Tab>
        )}
        {props.file != null && <Tab id="file">Why this file</Tab>}
      </TabList>
      <IconButton icon={X} size="sm" label="Close inspector" onClick={props.onClose} />
    </div>
  )
}

function FilePanel({ file }: { file: InspectorFile }) {
  return (
    <TabPanel id="file" className="ri-panel">
      <WhyThisFile file={file} />
    </TabPanel>
  )
}

export function ReviewInspector(props: ReviewInspectorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // The drawer sits over the diff, so a click on the diff must not close it: Escape and the X do.
  useDismissible({
    ref: rootRef,
    onDismiss: props.onClose,
    manageFocus: false,
    closeOnOutsideClick: false,
  })
  return (
    <TabsRoot selectedId={resolveTab(props)} onSelect={props.onTabChange}>
      <div className="ri-root" ref={rootRef}>
        <InspectorTabs inspector={props} />
        {props.agentAvailable && (
          <TabPanel id="agent" className="ri-panel">
            {props.agent}
          </TabPanel>
        )}
        {props.file && <FilePanel file={props.file} />}
      </div>
    </TabsRoot>
  )
}
