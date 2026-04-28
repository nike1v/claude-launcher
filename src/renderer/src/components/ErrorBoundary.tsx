import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  // What to render when a child throws. Receives the error so the fallback
  // can show a debug message; defaults to a small inline notice.
  fallback?: (err: Error) => ReactNode
  children: ReactNode
}

interface State {
  err: Error | null
}

// Generic error boundary used to keep one misbehaving subtree from
// unmounting the whole React root (which presents as a totally blank
// window after a thrown render error). React 18 unmounts on uncaught
// errors during render — wrapping a feature in this guards the rest of
// the UI.
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { err: null }

  public static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  public componentDidCatch(err: Error, info: ErrorInfo): void {
    // Best-effort log so DevTools shows context if the user opens it.
    console.error('[ErrorBoundary] caught render error', err, info.componentStack)
  }

  public render(): ReactNode {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err)
      return (
        <div className="p-4 text-xs text-danger">
          Something went wrong rendering this view. Open DevTools (Ctrl+Shift+I)
          for details.
          <pre className="mt-2 whitespace-pre-wrap">{this.state.err.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
