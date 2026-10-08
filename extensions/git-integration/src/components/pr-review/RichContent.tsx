import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import hljs from '../../utils/hljs'

// remark-rehype already prefixes footnote ids with 'user-content-'; sanitize's
// default prefix would double it and break in-page footnote links. The default
// schema unwraps <style>, which would print its CSS as text.
const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  strip: [...(defaultSchema.strip ?? []), 'style'],
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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a({ href, children }) {
            const isAbsolute = href?.startsWith('http://') || href?.startsWith('https://')
            return (
              <a
                href={href}
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
