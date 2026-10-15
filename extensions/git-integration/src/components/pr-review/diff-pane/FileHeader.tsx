import React from 'react'
import { Flame } from 'lucide-react'
import { plural } from '@terminator/extension-sdk'
import { ViewMenu } from '../ViewMenu'
import { UsesPopover } from '../UsesPopover'
import type { PrChangedFile, PrHead, ReadingStep } from '../../../schemas/pr-review.schema'
import { splitPath } from '../../text'
import './file-header.css'

type ReadingStepUse = ReadingStep['uses'][number]

export interface FileHeaderProps {
  file: PrChangedFile
  head: PrHead
  isViewed: boolean
  viewedFiles: Set<string>
  showChangedSince: boolean
  usesWithDef: ReadingStepUse[]
  menuNote: string | null
  onShowRisk: () => void
  onPeekDefinition: () => void
  setViewed: (head: PrHead, path: string, viewed: boolean) => void
}

function FileTitle(props: { file: PrChangedFile }) {
  const { file } = props
  const { dir: dirName, name: baseName } = splitPath(file.path)
  return (
    <span className="fh-path" title={file.path}>
      {dirName && (
        <span className="fh-dir">
          <bdi>{dirName}</bdi>
        </span>
      )}
      <span className="fh-name">{baseName}</span>
    </span>
  )
}

function RiskChip(props: { file: PrChangedFile; onShowRisk: () => void }) {
  if (props.file.riskScore.level !== 'high') return null
  return (
    <button
      type="button"
      className="fh-risk"
      onClick={props.onShowRisk}
      title="Why this risk level?"
    >
      <Flame aria-hidden="true" />
      High risk
    </button>
  )
}

function ChangedSince() {
  return (
    <span className="fh-changed" title="Changed since you viewed">
      Changed since you viewed
    </span>
  )
}

function ViewedToggle(props: FileHeaderProps) {
  const { file, head, isViewed } = props
  return (
    <label className="fh-viewed">
      <input
        type="checkbox"
        checked={isViewed}
        onChange={() => props.setViewed(head, file.path, !isViewed)}
      />
      Viewed
      <kbd className="tmui-kbd" aria-hidden="true">
        v
      </kbd>
    </label>
  )
}

/** Medium and low files have no risk chip; this opens the same explanation. */
function WhyThisFileButton(props: { file: PrChangedFile; onShowRisk: () => void }) {
  if (props.file.riskScore.level === 'high') return null
  return (
    <button type="button" className="fh-why-file" onClick={props.onShowRisk}>
      Why this file
    </button>
  )
}

function WhyHere(props: FileHeaderProps & { children: React.ReactNode }) {
  const churn = props.file.riskScore.metrics.churn90d
  return (
    <div className="fh-why">
      <span>
        <span className="fh-why-label">Why here:</span> {props.file.whyHere}
      </span>
      {props.children}
      {churn != null && (
        <>
          <span className="fh-sep">·</span>
          <span>
            Changed {churn} {plural(churn, 'time')} in 90 days
          </span>
        </>
      )}
      <WhyThisFileButton file={props.file} onShowRisk={props.onShowRisk} />
    </div>
  )
}

/** The file's header: its path, size and risk, then why it is in the review. */
export function FileHeader(props: FileHeaderProps) {
  const { file, viewedFiles } = props
  const uses = props.usesWithDef.map((u) => ({
    symbol: u.symbol,
    definedInStep: u.definedInStep!,
    read: u.definedInPath != null && viewedFiles.has(u.definedInPath),
  }))
  return (
    <div className="fh">
      <div className="fh-row">
        <FileTitle file={file} />
        <span className="fh-add">+{file.additions}</span>
        <span className="fh-del">−{file.deletions}</span>
        <RiskChip file={file} onShowRisk={props.onShowRisk} />
        {props.showChangedSince && <ChangedSince />}
        <span className="fh-spacer" />
        <ViewMenu sinceNote={props.menuNote} />
        <ViewedToggle {...props} />
      </div>
      <WhyHere {...props}>
        {uses.length > 0 && <span className="fh-sep">·</span>}
        <UsesPopover uses={uses} onPeekDefinition={props.onPeekDefinition} />
      </WhyHere>
    </div>
  )
}
