import React from 'react'
import { Markdown } from '@terminator/extension-ui'
import hljs from '../../utils/hljs'

interface Props {
  children: string
  className?: string
}

function highlightFenced(code: string, language: string): string {
  try {
    return hljs.highlight(code, { language }).value
  } catch {
    return hljs.highlightAuto(code).value
  }
}

function openLink(url: string): void {
  window.electronAPI.shell.openExternal(url).catch(() => {})
}

function renderHighlightedCode(code: string, language: string): React.ReactNode {
  return (
    <pre>
      <code
        className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: highlightFenced(code, language) }}
      />
    </pre>
  )
}

/** Markdown in the review UI: the design system's renderer, highlighted by hljs. */
export function RichContent({ children, className }: Props) {
  return (
    <Markdown
      className={`rich-content${className ? ` ${className}` : ''}`}
      onOpenLink={openLink}
      renderCode={renderHighlightedCode}
    >
      {children}
    </Markdown>
  )
}
