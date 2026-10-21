import React from 'react'
import { Copy, FileText, GitPullRequest, Sparkles, Ticket } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { ExternalLink } from './ExternalLink.js'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { OPEN_LABEL } from '../line/document-kind.js'
import type { DocumentLink } from '../line/document-kind.js'

// Where an order's document, pull requests and ticket are, as links that open
// outside the application. One component because the gate card, the order list
// and the factory hall all print them, and three copies drift.

export interface OrderLinksProps {
  readonly document?: DocumentLink | null
  readonly pulls?: readonly { readonly number: number; readonly url: string }[]
  readonly source?: { readonly key: string; readonly url: string } | null
}

export function OrderLinks({
  document = null,
  pulls = [],
  source = null,
}: OrderLinksProps): JSX.Element {
  return (
    <>
      {document === null ? null : <DocumentChip document={document} />}
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

/** Opens a document where it belongs: a link in the browser, a file with the system's own opener. */
function openDocument(document: DocumentLink): void {
  if (document.url !== null) openInBrowser(document.url)
  else void window.electronAPI.shell.openPath(document.path)
}

function chipLabel(document: DocumentLink): string {
  if (document.kind === 'claude-artifact') return 'Claude artifact'
  if (document.kind === 'link') return 'Document'
  return document.path.split('/').pop() ?? document.path
}

function DocumentChip({ document }: { readonly document: DocumentLink }) {
  const Icon = document.kind === 'claude-artifact' ? Sparkles : FileText
  const label = (
    <>
      <Icon aria-hidden="true" />
      {chipLabel(document)}
    </>
  )
  if (document.url !== null) return <ExternalLink href={document.url}>{label}</ExternalLink>
  return (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault()
        openDocument(document)
      }}
    >
      {label}
    </a>
  )
}

/** The moves on a finished order's document: open it, open the local copy, copy the link. */
export function DocumentActions({ document }: { readonly document: DocumentLink }): JSX.Element {
  return (
    <div className="fdry-doc-actions">
      <Button variant="primary" icon={Sparkles} onClick={() => openDocument(document)}>
        {OPEN_LABEL[document.kind]}
      </Button>
      {document.kind === 'file' ? null : (
        <Button
          variant="secondary"
          icon={FileText}
          onClick={() => void window.electronAPI.shell.openPath(document.path)}
        >
          Open local copy
        </Button>
      )}
      {document.url === null ? null : <CopyLink url={document.url} />}
    </div>
  )
}

function CopyLink({ url }: { readonly url: string }) {
  return (
    <Button
      variant="ghost"
      icon={Copy}
      onClick={() => void navigator.clipboard.writeText(url).catch(() => undefined)}
    >
      Copy link
    </Button>
  )
}

/** The primary "Open ..." move alone, for a surface too small for the whole row. */
export function OpenDocumentButton({ document }: { readonly document: DocumentLink }) {
  return (
    <Button variant="primary" size="sm" onClick={() => openDocument(document)}>
      {OPEN_LABEL[document.kind]}
    </Button>
  )
}
