import React from 'react'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'

type IssueRef = NonNullable<PrReviewDetail['issueRefs']>[number]

function IssueRefName({ issueRef }: { issueRef: IssueRef }) {
  const { url } = issueRef
  if (!url) return <span className="pr-overview-issue-ref-label">{issueRef.ref}</span>
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault()
        window.electronAPI.shell.openExternal(url).catch(() => {})
      }}
      className="pr-overview-issue-ref-link"
    >
      {issueRef.ref}
    </a>
  )
}

function IssueRefItem({ issueRef }: { issueRef: IssueRef }) {
  return (
    <li className="pr-overview-issue-ref">
      <IssueRefName issueRef={issueRef} />
      {issueRef.title !== undefined && (
        <span className="pr-overview-issue-ref-title">{issueRef.title}</span>
      )}
      {issueRef.state !== undefined && (
        <span className="pr-overview-issue-ref-state">{issueRef.state}</span>
      )}
      <span className="pr-overview-issue-ref-type">{issueRef.type}</span>
    </li>
  )
}

export function IssueRefList({ issueRefs }: { issueRefs: IssueRef[] }) {
  return (
    <ul className="pr-overview-issue-refs">
      {issueRefs.map((issueRef, index) => (
        <IssueRefItem key={index} issueRef={issueRef} />
      ))}
    </ul>
  )
}
