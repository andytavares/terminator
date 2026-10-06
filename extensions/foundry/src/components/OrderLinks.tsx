import React from 'react'
import { GitPullRequest, Ticket } from 'lucide-react'
import { ExternalLink } from './Markdown.js'

// Where an order's pull requests and its ticket are, as links that open outside
// the application. One component because the gate card, the order list and the
// factory hall all print them, and three copies drift.

export interface OrderLinksProps {
  readonly pulls?: readonly { readonly number: number; readonly url: string }[]
  readonly source?: { readonly key: string; readonly url: string } | null
}

export function OrderLinks({ pulls = [], source = null }: OrderLinksProps): JSX.Element {
  return (
    <>
      {pulls.map((pull) => (
        <ExternalLink key={pull.url} href={pull.url}>
          <GitPullRequest aria-hidden="true" />#{pull.number}
        </ExternalLink>
      ))}
      {source === null ? null : (
        <ExternalLink href={source.url}>
          <Ticket aria-hidden="true" />
          {source.key}
        </ExternalLink>
      )}
    </>
  )
}
