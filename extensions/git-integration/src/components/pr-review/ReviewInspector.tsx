import React from 'react'
import { X } from 'lucide-react'
import { IconButton, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import type { RiskScore } from '../../schemas/pr-review.schema'
import { RiskBreakdownPanel } from './RiskBreakdownPanel'
import { HealthChips } from './HealthChips'
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
    ciStatus?: 'passing' | 'failing' | 'pending' | 'none'
    lintStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
    coverageStatus?: 'pass' | 'fail' | 'warn' | 'unknown'
    dryViolationCount?: number
  } | null
}

export function ReviewInspector({
  tab,
  onTabChange,
  onClose,
  agentAvailable,
  agentFindingCount,
  agent,
  file,
}: ReviewInspectorProps) {
  const fileAvailable = file != null
  const activeTab: InspectorTab = tab === 'agent' && !agentAvailable ? 'file' : tab
  const resolvedTab: InspectorTab = activeTab === 'file' && !fileAvailable ? 'agent' : activeTab

  return (
    <TabsRoot selectedId={resolvedTab} onSelect={onTabChange}>
      <div className="ri-root">
        <div className="ri-header">
          <TabList label="Inspector" className="ri-tablist">
            {agentAvailable && (
              <Tab
                id="agent"
                accessibleName={agentFindingCount > 0 ? `Agent, ${agentFindingCount}` : undefined}
              >
                Agent
                {agentFindingCount > 0 && <span className="ri-tab-badge">{agentFindingCount}</span>}
              </Tab>
            )}
            {fileAvailable && <Tab id="file">File</Tab>}
          </TabList>
          <IconButton icon={X} size="sm" label="Close inspector" onClick={onClose} />
        </div>
        {agentAvailable && (
          <TabPanel id="agent" className="ri-panel">
            {agent}
          </TabPanel>
        )}
        {file && (
          <TabPanel id="file" className="ri-panel">
            <RiskBreakdownPanel
              filePath={file.path}
              riskScore={file.riskScore}
              repoRoot={file.repoRoot}
            />
            <HealthChips
              riskScore={file.riskScore}
              ciStatus={file.ciStatus}
              lintStatus={file.lintStatus}
              coverageStatus={file.coverageStatus}
              dryViolationCount={file.dryViolationCount}
            />
          </TabPanel>
        )}
      </div>
    </TabsRoot>
  )
}
