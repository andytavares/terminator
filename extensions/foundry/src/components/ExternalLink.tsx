import React from 'react'

/** Opens an address in the person's browser: a view cannot open a window of its own. */
export function openInBrowser(url: string): void {
  void window.electronAPI.shell?.openExternal(url)
}

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
}): JSX.Element {
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
