import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import hljs from '../../utils/hljs'

// rehype-sanitize prefixes every id and name, so in-page hrefs must carry the
// same prefix to reach their target. remark-rehype is told not to prefix
// footnote ids itself, or they would be prefixed twice.
const CLOBBER_PREFIX = 'user-content-'

interface Props {
  children: string
  className?: string
}

export function RichContent({ children, className }: Props) {
  return (
    <div className={`rich-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a({ href, children }) {
            const isAbsolute = href?.startsWith('http://') || href?.startsWith('https://')
            const isInPage = href?.startsWith('#') ?? false
            const target =
              isInPage && !href!.startsWith(`#${CLOBBER_PREFIX}`)
                ? `#${CLOBBER_PREFIX}${href!.slice(1)}`
                : href
            return (
              <a
                href={target}
                onClick={(e) => {
                  // The extension view has no navigation guard, so any other
                  // href would replace the view itself.
                  if (isInPage) return
                  e.preventDefault()
                  if (isAbsolute) window.electronAPI.shell.openExternal(href!).catch(() => {})
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
