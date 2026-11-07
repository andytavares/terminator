import React, { useEffect, useId, useState } from 'react'
import { Markdown } from '@terminator/extension-ui'
import { useSettingsStore } from '../../stores/settings.store'
import { openLinkExternally } from '../home/thread-actions'

type Drawing = { svg: string } | { error: string } | null

const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Diagram colours from the app's own tokens, so slices and bars read in both themes. */
function themeVariables(dark: boolean): Record<string, unknown> {
  const series = ['--tm-accent', '--tm-success', '--tm-warning', '--tm-danger', '--tm-accent-text']
  const colours = series.map(token)
  const slices = Object.fromEntries(colours.map((colour, i) => [`pie${i + 1}`, colour]))
  return {
    xyChart: { plotColorPalette: colours.join(',') },
    darkMode: dark,
    background: token('--tm-bg-base'),
    primaryColor: token('--tm-accent'),
    primaryTextColor: token('--tm-text-primary'),
    lineColor: token('--tm-text-secondary'),
    textColor: token('--tm-text-primary'),
    pieStrokeColor: token('--tm-bg-base'),
    pieOuterStrokeColor: token('--tm-border'),
    ...slices,
  }
}

// Mermaid is loaded on the first diagram, into its own chunk. 'strict' keeps a
// diagram's labels from carrying HTML or click handlers.
async function drawDiagram(id: string, code: string, dark: boolean): Promise<Drawing> {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(dark),
  })
  try {
    return { svg: (await mermaid.render(id, code)).svg }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function MermaidDiagram({ code }: { code: string }): React.JSX.Element {
  const id = `agent-mermaid-${useId().replace(/[^\w-]/g, '')}`
  const dark = useSettingsStore((s) => s.resolvedTheme) === 'dark'
  const [drawing, setDrawing] = useState<Drawing>(null)
  useEffect(() => {
    let current = true
    void drawDiagram(id, code, dark).then((next) => current && setDrawing(next))
    return () => {
      current = false
    }
  }, [id, code, dark])
  // Mermaid's own sanitiser has already cleaned this SVG ('strict').
  if (drawing && 'svg' in drawing)
    return <span className="agent-mermaid" dangerouslySetInnerHTML={{ __html: drawing.svg }} />
  return (
    <>
      {drawing && (
        <span role="note" className="agent-mermaid__error">
          {`This diagram could not be drawn: ${drawing.error}`}
        </span>
      )}
      <code className="language-mermaid">{code}</code>
    </>
  )
}

function codeOrDiagram(code: string, language: string): React.ReactNode {
  if (language === 'mermaid') return <MermaidDiagram code={code} />
  return <code className={`language-${language}`}>{code}</code>
}

/** An agent's reply: GitHub-flavoured Markdown with sanitised HTML and mermaid diagrams. Links
 * open in the browser, and nothing is fetched from the network. */
export function AgentMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <Markdown
      offline
      className="agent-markdown"
      onOpenLink={openLinkExternally}
      renderCode={codeOrDiagram}
    >
      {text}
    </Markdown>
  )
}
