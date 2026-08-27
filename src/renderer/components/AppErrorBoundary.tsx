import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message?: string
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false }

  public static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected renderer error occurred.',
    }
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the error boundary local to the renderer. Do not forward source data or
    // provider payloads to telemetry from this surface.
    if (typeof console !== 'undefined')
      console.error('SupplierOps renderer error', error, info.componentStack)
  }

  public render() {
    if (!this.state.hasError) return this.props.children
    return (
      <main className="fatal-state" aria-labelledby="fatal-state-title">
        <div className="fatal-state__inner">
          <span className="fatal-state__icon" aria-hidden="true">
            <Icon name="alert" size={22} />
          </span>
          <p className="eyebrow">Renderer stopped safely</p>
          <h1 id="fatal-state-title">The workspace could not be displayed.</h1>
          <p>
            No external action was taken. Reload the local sandbox and reopen the case. If this
            keeps happening, share the timestamp with your administrator.
          </p>
          <p className="fatal-state__detail">{this.state.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      </main>
    )
  }
}
