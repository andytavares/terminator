import React from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { ExternalLink } from './ExternalLink.js'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import type { DocumentLink } from '../line/document-kind.js'

// An order's document as a link, beside its pull requests and ticket. Its own module so
// only the views that draw it load it: the entry chunk (the Inbox) is at its budget.

/** Opens a document where it belongs: a link in the browser, a file with the system's own opener. */
export function openDocument(document: DocumentLink): void {
  if (document.url !== null) openInBrowser(document.url)
  else void window.electronAPI.shell.openPath(document.path)
}

function chipLabel(document: DocumentLink): string {
  if (document.kind === 'claude-artifact') return 'Claude artifact'
  if (document.kind === 'link') return 'Document'
  return document.path.split('/').pop() ?? document.path
}

export function DocumentChip({ document }: { readonly document: DocumentLink }) {
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
