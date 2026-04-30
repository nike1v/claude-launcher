import { respondPermission } from '../../ipc/bridge'

interface Props {
  sessionId: string
  toolUseId: string
  toolName: string
  input: unknown
  resolved?: boolean
}

export function PermissionPrompt({ sessionId, toolUseId, toolName, input, resolved }: Props) {
  const handle = (decision: 'allow' | 'deny') =>
    respondPermission(sessionId, decision, toolUseId)

  return (
    // t3code alert recipe: surface at /8, border at /32, icon/text at full
    // strength. `bg-warn` and `text-warn` resolve to per-theme tokens — a
    // bright amber on dark, a darker amber on light — so the box reads
    // legibly on either surface without us hand-tuning two separate
    // shades per component.
    <div className="border border-warn/32 bg-warn/8 rounded-lg px-4 py-3 space-y-2">
      <p className="text-xs text-warn font-medium">Permission Request</p>
      <p className="text-sm text-fg">
        Run: <span className="font-mono text-fg">{toolName}</span>
      </p>
      {/* `input` is `unknown` — coerce to boolean before short-circuiting so
          React's children type doesn't see `unknown`. */}
      {Boolean(input) && (
        <pre className="text-xs text-fg-faint overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
      {resolved ? (
        <p className="text-xs text-fg-faint italic pt-1">resolved</p>
      ) : (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handle('allow')}
            className="px-3 py-1.5 bg-success/12 hover:bg-success/20 border border-success/32 text-success text-xs rounded transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => handle('deny')}
            className="px-3 py-1.5 bg-danger/12 hover:bg-danger/20 border border-danger/32 text-danger text-xs rounded transition-colors"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  )
}
