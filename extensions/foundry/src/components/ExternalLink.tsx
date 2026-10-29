import React from 'react'
import { openInBrowser } from '@terminator/extension-sdk/renderer'

// A link that opens in the person's browser. A view has no window-open handler, so
// `target="_blank"` goes nowhere: the href stays for the status bar and assistive
// technology, and the click is what opens it.
export function ExternalLink({
  href,
  children,
  className,
}: {
  readonly href: string
  readonly children: React.ReactNode
  readonly className?: string
}): React.JSX.Element {
  return (
    <a
      href={href}
      className={className}
      rel="noreferrer noopener"
      onClick={(event) => {
        event.preventDefault()
        openInBrowser(href)
      }}
    >
      {children}
    </a>
  )
}
