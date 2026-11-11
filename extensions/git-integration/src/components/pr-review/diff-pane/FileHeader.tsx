import React from 'react'
import { plural } from '@terminator/extension-sdk'
import { UsesPopover } from '../UsesPopover'
import type { PrChangedFile, ReadingStep } from '../../../schemas/pr-review.schema'
import { splitPath } from '../../text'
import './file-header.css'

type ReadingStepUse = ReadingStep['uses'][number]

export interface FileHeaderProps {
  file: PrChangedFile
  viewedFiles: Set<string>
  showChangedSince: boolean
  usesWithDef: ReadingStepUse[]
  /** Which head the diff shows, when it is not the pull request's latest. */
  menuNote: string | null
  onPeekDefinition: () => void
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

function ChangedSince() {
  return (
    <span className="fh-changed" title="Changed since you viewed">
      Changed since you viewed
    </span>
  )
}

function ChurnFact({ churn }: { churn: number }) {
  return (
    <span>
      Changed {churn} {plural(churn, 'time')} in 90 days
    </span>
  )
}

type BlastRadius = NonNullable<PrChangedFile['blastRadius']>

function BlastRadiusFact({ radius }: { radius: BlastRadius }) {
  const { usedIn, alsoDefinedIn } = radius
  const alsoDefined =
    alsoDefinedIn > 0
      ? ` · name also defined in ${alsoDefinedIn} ${plural(alsoDefinedIn, 'file')}`
      : ''
  return (
    <span>
      Used in {usedIn} {plural(usedIn, 'file')}
      {alsoDefined}
    </span>
  )
}

function shownRadius(radius: PrChangedFile['blastRadius']): BlastRadius | null {
  return radius && radius.usedIn > 0 ? radius : null
}

/** The reading-order reason, the 90-day change count and the blast radius, each when known. */
function WhyHere(props: { file: PrChangedFile; children: React.ReactNode }) {
  const { whyHere, churn90d } = props.file
  const radius = shownRadius(props.file.blastRadius)
  return (
    <div className="fh-why">
      {whyHere && (
        <span>
          <span className="fh-why-label">Why here:</span> {whyHere}
        </span>
      )}
      {props.children}
      {whyHere && churn90d != null && <span className="fh-sep">·</span>}
      {churn90d != null && <ChurnFact churn={churn90d} />}
      {radius && (whyHere || churn90d != null) && <span className="fh-sep">·</span>}
      {radius && <BlastRadiusFact radius={radius} />}
    </div>
  )
}

/** The file's header: its path and size, then why it is in the review. */
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
        {props.showChangedSince && <ChangedSince />}
        <span className="fh-spacer" />
        {props.menuNote && <span className="fh-note">{props.menuNote}</span>}
      </div>
      <WhyHere file={file}>
        {uses.length > 0 && <span className="fh-sep">·</span>}
        <UsesPopover uses={uses} onPeekDefinition={props.onPeekDefinition} />
      </WhyHere>
    </div>
  )
}
