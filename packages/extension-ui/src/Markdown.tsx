import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './extension-ui.css'

type RehypePlugins = Options['rehypePlugins']

type Schema = typeof import('rehype-sanitize').defaultSchema

// Shapes and text only, for a chart drawn as inline SVG: no `style`, `href`, `use`,
// `foreignObject` or animation, so an SVG can neither run code nor fetch anything.
const SVG_SHAPES = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']
// No <title>: React moves one into the document head, where a body would rename the window.
const SVG_TAGS = [...SVG_SHAPES, 'text', 'tspan']
const SVG_ATTRIBUTES = [
  ...['viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry'],
  ...['d', 'points', 'transform', 'fill', 'stroke', 'strokeWidth', 'opacity', 'fillOpacity'],
  ...['textAnchor', 'dominantBaseline', 'fontSize', 'fontWeight', 'xmlns'],
]

// The default schema unwraps <style>, which would print its CSS as text, so it is
// stripped as well (ADR 091).
function withSvg(schema: Schema): Schema {
  return {
    ...schema,
    strip: [...(schema.strip ?? []), 'style'],
    tagNames: [...(schema.tagNames ?? []), ...SVG_TAGS],
    attributes: {
      ...schema.attributes,
      ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
    },
  }
}

// Loaded on first use, into its own chunk: rehype-raw's HTML parser is large and
// most Markdown has no HTML in it.
let htmlPlugins: RehypePlugins
let htmlPluginsLoading: Promise<RehypePlugins> | undefined
function loadHtmlPlugins(): Promise<RehypePlugins> {
  htmlPluginsLoading ??= Promise.all([import('rehype-raw'), import('rehype-sanitize')]).then(
    ([raw, sanitize]) => {
      htmlPlugins = [raw.default, [sanitize.default, withSvg(sanitize.defaultSchema)]]
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
  /** Draws a fenced block that names a language, e.g. with a syntax highlighter. Without it the
   * block renders as plain `pre` and `code`. */
  renderCode?: (code: string, language: string) => React.ReactNode
  /** One line, in a `span`: code, bold, italic, strikethrough and links, so it can sit inside a
   * button or a label. Any other block keeps only its words. */
  inline?: boolean
  /** For text anyone can write, such as a tracker's issue: raw HTML is dropped, not parsed, and
   * no image or other `src` survives, so nothing is fetched. */
  fetchesNothing?: boolean
  /** For text that may hold HTML but must not reach the network, such as an agent's reply: raw
   * HTML still renders, but no image or other `src` survives. */
  offline?: boolean
}

const OPENS_OUTSIDE = /^(https?|mailto):/i
const INLINE_ELEMENTS = ['code', 'strong', 'em', 'del', 'a']

// The link reads its handler from context, so it stays one component type: a new type per render
// would remount every link whenever the view re-rendered, losing a click or focus that landed on it.
const OpenLinkContext = createContext<(url: string) => void>(() => undefined)

const MarkdownLink: Components['a'] = ({ href, children }) => {
  const onOpenLink = useContext(OpenLinkContext)
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

// Null removes the attribute outright; every other address still goes through
// the library's own guard against `javascript:` and friends.
function withoutResources(url: string, key: string): string | null {
  return key === 'src' ? null : defaultUrlTransform(url)
}

function markdownComponents({
  renderCode,
  fetchesNothing,
  offline,
}: Omit<MarkdownProps, 'children' | 'onOpenLink'>): Components {
  return {
    a: MarkdownLink,
    // An image whose address was removed is not worth a broken-image icon.
    ...((fetchesNothing || offline) && { img: () => null }),
    code({ className, children }) {
      const language = /language-(\w+)/.exec(className ?? '')?.[1]
      if (!language || !renderCode) return <code className={className}>{children}</code>
      return <>{renderCode(String(children).replace(/\n$/, ''), language)}</>
    },
  }
}

/** The HTML plugins, loaded on first use; text that fetches nothing never needs them. */
function useHtmlPlugins(fetchesNothing: boolean | undefined) {
  const [rehypePlugins, setRehypePlugins] = useState(htmlPlugins)
  useEffect(() => {
    if (!rehypePlugins && !fetchesNothing) void loadHtmlPlugins().then(setRehypePlugins)
  }, [rehypePlugins, fetchesNothing])
  return rehypePlugins
}

/** The one Markdown renderer: react-markdown with GitHub-flavoured Markdown, and raw HTML parsed
 * then sanitised. A body can come from a pull request or an agent, and this view can run shell
 * commands, so nothing here sets inner HTML. */
export function Markdown(props: MarkdownProps): React.JSX.Element {
  const { children, className, inline, fetchesNothing, offline, renderCode, onOpenLink } = props
  const components = useMemo(
    () => markdownComponents({ renderCode, fetchesNothing, offline }),
    [renderCode, fetchesNothing, offline]
  )
  const rehypePlugins = useHtmlPlugins(fetchesNothing)

  const Container = inline ? 'span' : 'div'
  const classes = ['tmui-markdown', inline && 'tmui-markdown--inline', className]
  return (
    <Container className={classes.filter(Boolean).join(' ')}>
      <OpenLinkContext.Provider value={onOpenLink}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml={fetchesNothing || !rehypePlugins}
          remarkRehypeOptions={{ clobberPrefix: '' }}
          rehypePlugins={fetchesNothing ? undefined : rehypePlugins}
          urlTransform={fetchesNothing || offline ? withoutResources : undefined}
          allowedElements={inline ? INLINE_ELEMENTS : undefined}
          unwrapDisallowed={inline}
          components={components}
        >
          {children}
        </ReactMarkdown>
      </OpenLinkContext.Provider>
    </Container>
  )
}
