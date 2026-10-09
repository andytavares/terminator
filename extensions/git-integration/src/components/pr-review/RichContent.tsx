import React, { useEffect, useState } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from '../../utils/hljs'

type RehypePlugins = Options['rehypePlugins']

// Loaded on first use, into its own chunk: rehype-raw's HTML parser would push
// the review UI past its chunk budget (vite.renderer.config.ts). The default
// sanitize schema unwraps <style>, which would print its CSS as text.
let htmlPlugins: RehypePlugins
let htmlPluginsLoading: Promise<RehypePlugins> | undefined
function loadHtmlPlugins() {
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
function inPageHref(href: string | undefined) {
  if (!href?.startsWith('#') || href.startsWith(`#${CLOBBER_PREFIX}`)) return href
  return `#${CLOBBER_PREFIX}${href.slice(1)}`
}

interface Props {
  children: string
  className?: string
}

export function RichContent({ children, className }: Props) {
  const [rehypePlugins, setRehypePlugins] = useState(htmlPlugins)
  useEffect(() => {
    if (!rehypePlugins) void loadHtmlPlugins().then(setRehypePlugins)
  }, [rehypePlugins])

  return (
    <div className={`rich-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={!rehypePlugins}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        rehypePlugins={rehypePlugins}
        components={{
          a({ href, children }) {
            const isAbsolute = href?.startsWith('http://') || href?.startsWith('https://')
            // Extension views have no navigation guard, so a relative or
            // protocol-relative href would replace the view itself.
            const navigatesView =
              !!href && !href.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(href)
            return (
              <a
                href={inPageHref(href)}
                onClick={(e) => {
                  if (navigatesView) e.preventDefault()
                  if (!isAbsolute) return
                  e.preventDefault()
                  window.electronAPI.shell.openExternal(href!).catch(() => {})
                }}
              >
                {children}
              </a>
            )
          },
          code({ className: cls, children: code }) {
            const match = /language-(\w+)/.exec(cls ?? '')
            if (!match) {
              return <code className={cls}>{code}</code>
            }
            const lang = match[1]
            const text = String(code).replace(/\n$/, '')
            let highlighted = text
            try {
              highlighted = hljs.highlight(text, { language: lang }).value
            } catch {
              highlighted = hljs.highlightAuto(text).value
            }
            return (
              <pre>
                <code
                  className={`hljs language-${lang}`}
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </pre>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
