import React from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './IssueMarkdown.css'

// Issue text, rendered.
//
// This is the only place issue content becomes DOM, and issue content is
// untrusted remote text: anyone who can comment on a ticket can put anything
// they like in here. It must render — reading a description as raw markup is
// worse than reading it in the tracker — and it must never act.
//
// Four rules, all of them enforced by props rather than by hoping:
//
//   1. `skipHtml` — raw HTML in the source is removed, not escaped-and-shown
//      and certainly not parsed. There is deliberately no `rehype-raw`.
//   2. `urlTransform` drops every `src`, so no image, no video, no anything
//      can cause a fetch. A remote image in an issue body is a tracking pixel
//      aimed at whoever opens the ticket.
//   3. Links go through the shell, never through navigation — an artifact
//      window that navigated to a link in a comment would be gone.
//   4. The library's own `defaultUrlTransform` is *composed with*, never
//      replaced — it is what strips `javascript:` and friends, and a custom
//      transform that forgets to call it silently reopens that hole.

export interface IssueMarkdownProps {
  children: string
}

/** Only these ever reach the operator's browser. */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:']

/**
 * No `src` survives, and no unsafe scheme does either.
 *
 * Returning null for `src` is react-markdown's documented way of removing a
 * resource outright rather than leaving a broken one. Everything else is
 * delegated to `defaultUrlTransform`, which is the library's own protocol
 * guard — replacing it instead of calling it is how a `javascript:` link gets
 * back into the DOM.
 */
function urlTransform(url: string, key: string): string {
  if (key === 'src') return ''
  return defaultUrlTransform(url)
}

/** Belt and braces: never hand the shell something that is not a web link. */
function isSafeExternal(href: string): boolean {
  try {
    return SAFE_PROTOCOLS.includes(new URL(href, 'https://example.invalid').protocol)
  } catch {
    return false
  }
}

export function IssueMarkdown({ children }: IssueMarkdownProps): JSX.Element {
  return (
    <div className="issue-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a: ({ href, children: label }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (typeof href === 'string' && href.length > 0 && isSafeExternal(href)) {
                  void window.electronAPI?.shell?.openExternal(href)
                }
              }}
            >
              {label}
            </a>
          ),
          // Whatever urlTransform left behind for an image is not worth a
          // broken-image icon in the middle of a description.
          img: () => null,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
