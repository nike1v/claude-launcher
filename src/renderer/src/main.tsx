import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Top-level error boundary catches anything that would otherwise unmount
// the whole React root and leave the user staring at a blank window. The
// fallback is intentionally minimal but actionable — open DevTools for the
// stack, then reload the window.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={err => (
        <div className="p-6 text-sm text-white/80 max-w-2xl">
          <h1 className="text-base font-semibold mb-2">Something went wrong</h1>
          <p className="text-white/60 mb-3">
            The launcher hit a render error. Open DevTools (Ctrl+Shift+I) for
            the full stack, then reload the window (Ctrl+R).
          </p>
          <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-words bg-white/5 p-3 rounded">
            {err.stack ?? err.message}
          </pre>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
