import React from 'react'
import { X } from 'lucide-react'
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
    <div className="ri-root">
      <div className="ri-header">
        <div className="ri-tablist" role="tablist" aria-label="Inspector">
          {agentAvailable && (
            <button
              type="button"
              role="tab"
              aria-selected={resolvedTab === 'agent'}
              className={`ri-tab${resolvedTab === 'agent' ? ' ri-tab--active' : ''}`}
              onClick={() => onTabChange('agent')}
            >
              Agent
              {agentFindingCount > 0 && <span className="ri-tab-badge">{agentFindingCount}</span>}
            </button>
          )}
          {fileAvailable && (
            <button
              type="button"
              role="tab"
              aria-selected={resolvedTab === 'file'}
              className={`ri-tab${resolvedTab === 'file' ? ' ri-tab--active' : ''}`}
              onClick={() => onTabChange('file')}
            >
              File
            </button>
          )}
        </div>
        <button type="button" className="ri-close" aria-label="Close inspector" onClick={onClose}>
          <X className="tm-icon-sm" />
        </button>
      </div>
      <div className="ri-panel" role="tabpanel">
        {resolvedTab === 'agent' && agentAvailable && agent}
        {resolvedTab === 'file' && file && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
