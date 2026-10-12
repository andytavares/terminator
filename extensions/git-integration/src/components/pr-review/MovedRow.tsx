import React from 'react'

interface Props {
  symbol: string | null
  lineCount: number
  /** Where the block is when collapsed: for a "moved here" row, its old location; for a "moved away" row, its new one. */
  otherPath: string
  otherLine: number
  direction: 'here' | 'away'
  expanded: boolean
  onToggleShow: () => void
  onGoToOrigin: () => void
}

/** Where the block came from, or where it went. */
function MovedPlace({ direction, at }: { direction: Props['direction']; at: string }) {
  return (
    <>
      {direction === 'here' ? 'from' : 'moved to'} <code>{at}</code>
    </>
  )
}

/** One collapsed row standing in for a moved-but-unchanged block (S4). */
export function MovedRow(props: Props) {
  const { symbol } = props
  return (
    <div className="rs-moved">
      <span className="rs-chip">Moved</span>
      <span>
        {symbol && <b>{symbol}</b>}
        {symbol ? ' · ' : ''}
        {props.lineCount} lines, unchanged,{' '}
        <MovedPlace direction={props.direction} at={`${props.otherPath}:${props.otherLine}`} />
      </span>
      <span className="rs-sp" />
      <button type="button" className="rs-btn" onClick={props.onToggleShow}>
        {props.expanded ? 'Hide' : 'Show'}
      </button>
      <button type="button" className="rs-btn" onClick={props.onGoToOrigin}>
        Go to origin
      </button>
    </div>
  )
}
