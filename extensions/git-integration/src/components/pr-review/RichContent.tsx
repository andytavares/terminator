import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import hljs from '../../utils/hljs'

// The default schema unwraps <style>, which would print its CSS as text.
const sanitizeSchema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip ?? []), 'style'],
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
  return (
    <div className={`rich-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: '' }}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a({ href, children }) {
            const isAbsolute = href?.startsWith('http://') || href?.startsWith('https://')
            return (
              <a
                href={inPageHref(href)}
                onClick={(e) => {
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
