import React from 'react'

export function DiffSize({
  additions,
  deletions,
  fileCount,
}: {
  additions: number
  deletions: number
  fileCount: number
}): JSX.Element {
  return (
    <span className="rd-num rd-size">
      <span className="rd-add">+{additions.toLocaleString('en-US')}</span>{' '}
      <span className="rd-del">−{deletions.toLocaleString('en-US')}</span> ·{' '}
      {fileCount.toLocaleString('en-US')} file{fileCount === 1 ? '' : 's'}
    </span>
  )
}
