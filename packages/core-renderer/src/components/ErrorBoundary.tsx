import React from 'react'
import { makeRendererLogger } from '../logger'
import { recordUse } from '../usage/record'

const log = makeRendererLogger('error-boundary')

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    recordUse('core.app.render-error', 'app', { failed: true })
    log.error(`Unhandled render error: ${error.message}`, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorScreen
          message={this.state.error.message}
          onRecover={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}

const SCREEN_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 16,
  fontFamily: 'monospace',
  background: 'var(--tm-bg-base)',
  color: 'var(--tm-danger)',
  padding: 32,
}

const MESSAGE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--tm-text-secondary)',
  maxWidth: 480,
  textAlign: 'center',
  lineHeight: 1.6,
}

const RECOVER_STYLE: React.CSSProperties = {
  marginTop: 8,
  padding: '7px 20px',
  background: 'color-mix(in srgb, var(--tm-danger) 15%, transparent)',
  border: '1px solid color-mix(in srgb, var(--tm-danger) 40%, transparent)',
  borderRadius: 6,
  color: 'var(--tm-danger)',
  fontFamily: 'monospace',
  fontSize: 12,
  cursor: 'pointer',
}

/** What shows in place of a tree that threw while rendering. */
function ErrorScreen({ message, onRecover }: { message: string; onRecover: () => void }) {
  return (
    <div style={SCREEN_STYLE}>
      <div style={{ fontSize: 32 }}>⚠</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
      <div style={MESSAGE_STYLE}>{message}</div>
      <button style={RECOVER_STYLE} onClick={onRecover}>
        Try to recover
      </button>
    </div>
  )
}
