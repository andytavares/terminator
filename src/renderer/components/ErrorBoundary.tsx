import React from 'react'

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
    console.error('Unhandled render error:', error.message, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          fontFamily: 'monospace',
          background: '#0c0c0f',
          color: '#f87171',
          padding: 32,
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: '#9ca3af', maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
            {this.state.error.message}
          </div>
          <button
            style={{
              marginTop: 8,
              padding: '7px 20px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 6,
              color: '#f87171',
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
