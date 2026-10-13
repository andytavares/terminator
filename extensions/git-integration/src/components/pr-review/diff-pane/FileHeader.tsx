import React from 'react'
import { ViewMenu } from '../ViewMenu'
import { UsesPopover } from '../UsesPopover'
import type { PrChangedFile, PrHead, ReadingStep } from '../../../schemas/pr-review.schema'

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

const RISK_LABEL = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' } as const

/** "src/app/" and "main.ts" from "src/app/main.ts". */
function splitPath(path: string): { dirName: string; baseName: string } {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return { dirName: '', baseName: path }
  return { dirName: path.slice(0, slash + 1), baseName: path.slice(slash + 1) }
}

function FileTitle(props: { file: PrChangedFile }) {
  const { file } = props
  const { dirName, baseName } = splitPath(file.path)
  return (
    <span className="rs-p" title={file.path}>
      {dirName && <span className="rs-p-dir">{dirName}</span>}
      {baseName}
    </span>
  )
}

function ChangedSince() {
  return (
    <span className="rs-note rs-note--changed" title="Changed since you viewed">
      <span className="rs-long">Changed since you viewed</span>
      <span className="rs-short">Changed</span>
    </span>
  )
}

function ViewedToggle(props: FileHeaderProps) {
  const { file, head, isViewed } = props
  return (
    <label className="rs-viewed">
      <input
        type="checkbox"
        checked={isViewed}
        onChange={() => props.setViewed(head, file.path, !isViewed)}
      />
      Viewed
    </label>
  )
}

/** The file's header: its path, risk, whether it changed since viewed, the menus and the viewed box. */
export function FileHeader(props: FileHeaderProps) {
  const { file, viewedFiles } = props
  const uses = props.usesWithDef.map((u) => ({
    symbol: u.symbol,
    definedInStep: u.definedInStep!,
    read: u.definedInPath != null && viewedFiles.has(u.definedInPath),
  }))
  return (
    <div className="rs-fh">
      <FileTitle file={file} />
      <button
        type="button"
        className={`rs-risk rs-risk--${file.riskScore.level}`}
        onClick={props.onShowRisk}
        title="Why this risk level?"
      >
        {RISK_LABEL[file.riskScore.level]}
      </button>
      {props.showChangedSince && <ChangedSince />}
      <span className="rs-sp" />
      <UsesPopover uses={uses} onPeekDefinition={props.onPeekDefinition} />
      <ViewMenu sinceNote={props.menuNote} />
      <span className="rs-fh-sep" />
      <ViewedToggle {...props} />
    </div>
  )
}
