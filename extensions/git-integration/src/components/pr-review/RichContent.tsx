import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'

interface Props {
  children: string
  className?: string
}

export function RichContent({ children, className }: Props) {
  return (
    <div className={`rich-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  if (href) window.electronAPI.shell.openExternal(href).catch(() => {})
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
