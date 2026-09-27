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

/** One collapsed row standing in for a moved-but-unchanged block (S4). */
export function MovedRow({
  symbol,
  lineCount,
  otherPath,
  otherLine,
  direction,
  expanded,
  onToggleShow,
  onGoToOrigin,
}: Props) {
  return (
    <div className="rs-moved">
      <span className="rs-chip">Moved</span>
      <span>
        {symbol && <b>{symbol}</b>}
        {symbol ? ' · ' : ''}
        {lineCount} lines, unchanged,{' '}
        {direction === 'here' ? (
          <>
            from <code>{`${otherPath}:${otherLine}`}</code>
          </>
        ) : (
          <>
            moved to <code>{`${otherPath}:${otherLine}`}</code>
          </>
        )}
      </span>
      <span className="rs-sp" />
      <button type="button" className="rs-btn" onClick={onToggleShow}>
        {expanded ? 'Hide' : 'Show'}
      </button>
      <button type="button" className="rs-btn" onClick={onGoToOrigin}>
        Go to origin
      </button>
    </div>
  )
}
