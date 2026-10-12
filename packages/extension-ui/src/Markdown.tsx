import React, { useEffect, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
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
  /** Called with the absolute http(s) or mailto address the reader clicked. */
  onOpenLink: (url: string) => void
  /**
   * Draws a fenced block that names a language, e.g. with a syntax highlighter.
   * Without it the block renders as plain `pre` and `code`.
   */
  renderCode?: (code: string, language: string) => React.ReactNode
  /**
   * One line, in a `span`: code, bold, italic, strikethrough and links, so it
   * can sit inside a button or a label. Any other block keeps only its words.
   */
  inline?: boolean
  /**
   * For text anyone can write, such as a tracker's issue: raw HTML is dropped,
   * not parsed, and no image or other `src` survives, so nothing is fetched.
   */
  fetchesNothing?: boolean
}

const OPENS_OUTSIDE = /^(https?|mailto):/i
const INLINE_ELEMENTS = ['code', 'strong', 'em', 'del', 'a']

function markdownLink(onOpenLink: (url: string) => void): Components['a'] {
  return function MarkdownLink({ href, children }) {
    return (
      <a
        href={inPageHref(href)}
        onClick={(event) => {
          // Extension views have no navigation guard, so anything but an in-page
          // link would replace the view itself, an empty href included.
          if (href?.startsWith('#')) return
          event.preventDefault()
          if (href && OPENS_OUTSIDE.test(href)) onOpenLink(href)
        }}
      >
        {children}
      </a>
    )
  }
}

// Null removes the attribute outright; every other address still goes through
// the library's own guard against `javascript:` and friends.
function withoutResources(url: string, key: string): string | null {
  return key === 'src' ? null : defaultUrlTransform(url)
}

function markdownComponents({ onOpenLink, renderCode, fetchesNothing }: MarkdownProps): Components {
  return {
    a: markdownLink(onOpenLink),
    // An image whose address was removed is not worth a broken-image icon.
    ...(fetchesNothing && { img: () => null }),
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
  const { children, className, inline, fetchesNothing } = props
  const [rehypePlugins, setRehypePlugins] = useState(htmlPlugins)
  useEffect(() => {
    if (!rehypePlugins && !fetchesNothing) void loadHtmlPlugins().then(setRehypePlugins)
  }, [rehypePlugins, fetchesNothing])

  const Container = inline ? 'span' : 'div'
  const classes = ['tmui-markdown', inline && 'tmui-markdown--inline', className]
  return (
    <Container className={classes.filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={fetchesNothing || !rehypePlugins}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        rehypePlugins={fetchesNothing ? undefined : rehypePlugins}
        urlTransform={fetchesNothing ? withoutResources : undefined}
        allowedElements={inline ? INLINE_ELEMENTS : undefined}
        unwrapDisallowed={inline}
        components={markdownComponents(props)}
      >
        {children}
      </ReactMarkdown>
    </Container>
  )
}
