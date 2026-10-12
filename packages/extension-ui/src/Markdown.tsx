import React, { useEffect, useState } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './extension-ui.css'

type RehypePlugins = Options['rehypePlugins']

// Loaded on first use, into its own chunk: rehype-raw's HTML parser is large and
// most Markdown has no HTML in it. The default sanitize schema unwraps <style>,
// which would print its CSS as text, so it is stripped as well (ADR 091).
let htmlPlugins: RehypePlugins
let htmlPluginsLoading: Promise<RehypePlugins> | undefined
function loadHtmlPlugins(): Promise<RehypePlugins> {
  htmlPluginsLoading ??= Promise.all([import('rehype-raw'), import('rehype-sanitize')]).then(
    ([raw, sanitize]) => {
      const { defaultSchema } = sanitize
      htmlPlugins = [
        raw.default,
        [sanitize.default, { ...defaultSchema, strip: [...(defaultSchema.strip ?? []), 'style'] }],
      ]
      return htmlPlugins
    }
  )
  return htmlPluginsLoading
}

const CLOBBER_PREFIX = 'user-content-'

// The sanitiser prefixes every id, so an in-page link has to be prefixed too.
function inPageHref(href: string | undefined): string | undefined {
  if (!href?.startsWith('#') || href.startsWith(`#${CLOBBER_PREFIX}`)) return href
  return `#${CLOBBER_PREFIX}${href.slice(1)}`
}

export interface MarkdownProps {
  children: string
  className?: string
  /** Called with an absolute http(s) address the reader clicked. */
  onOpenLink: (url: string) => void
  /**
   * Draws a fenced block that names a language, e.g. with a syntax highlighter.
   * Without it the block renders as plain `pre` and `code`.
   */
  renderCode?: (code: string, language: string) => React.ReactNode
}

function markdownLink(onOpenLink: (url: string) => void): Components['a'] {
  return function MarkdownLink({ href, children }) {
    const isAbsolute = href?.startsWith('http://') || href?.startsWith('https://')
    // Extension views have no navigation guard, so a relative or
    // protocol-relative href would replace the view itself.
    const navigatesView = !!href && !href.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(href)
    return (
      <a
        href={inPageHref(href)}
        onClick={(event) => {
          if (navigatesView) event.preventDefault()
          if (!isAbsolute) return
          event.preventDefault()
          onOpenLink(href!)
        }}
      >
        {children}
      </a>
    )
  }
}

function markdownComponents({ onOpenLink, renderCode }: MarkdownProps): Components {
  return {
    a: markdownLink(onOpenLink),
    code({ className, children }) {
      const language = /language-(\w+)/.exec(className ?? '')?.[1]
      if (!language || !renderCode) return <code className={className}>{children}</code>
      return <>{renderCode(String(children).replace(/\n$/, ''), language)}</>
    },
  }
}

/**
 * The one Markdown renderer: react-markdown with GitHub-flavoured Markdown, and
 * raw HTML parsed then sanitised. A body can come from a pull request or an
 * agent, and this view can run shell commands, so nothing here sets inner HTML.
 */
export function Markdown(props: MarkdownProps): JSX.Element {
  const { children, className } = props
  const [rehypePlugins, setRehypePlugins] = useState(htmlPlugins)
  useEffect(() => {
    if (!rehypePlugins) void loadHtmlPlugins().then(setRehypePlugins)
  }, [rehypePlugins])

  return (
    <div className={`tmui-markdown${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={!rehypePlugins}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        rehypePlugins={rehypePlugins}
        components={markdownComponents(props)}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
