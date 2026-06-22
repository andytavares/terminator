import React from 'react'
import { makeRendererLogger } from '../logger'

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
    log.error(`Unhandled render error: ${error.message}`, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 16,
            fontFamily: 'monospace',
            background: 'var(--bg-base)',
            color: 'var(--danger)',
            padding: 32,
          }}
        >
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              maxWidth: 480,
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            {this.state.error.message}
          </div>
          <button
            style={{
              marginTop: 8,
              padding: '7px 20px',
              background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              borderRadius: 6,
              color: 'var(--danger)',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: 'pointer',
            }}
            onClick={() => this.setState({ error: null })}
          >
            Try to recover
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
