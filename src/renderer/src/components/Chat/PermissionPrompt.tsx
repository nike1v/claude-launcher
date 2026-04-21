import { respondPermission } from '../../ipc/bridge'

interface Props {
  sessionId: string
  toolUseId: string
  toolName: string
  input: unknown
}

export function PermissionPrompt({ sessionId, toolUseId, toolName, input }: Props): JSX.Element {
  const handle = (decision: 'allow' | 'deny') =>
    respondPermission(sessionId, decision, toolUseId)

  return (
    <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg px-4 py-3 space-y-2">
      <p className="text-xs text-yellow-400/80 font-medium">Permission Request</p>
      <p className="text-sm text-white/80">
        Run: <span className="font-mono text-white">{toolName}</span>
      </p>
      {input && (
        <pre className="text-xs text-white/40 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => handle('allow')}
          className="px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 text-xs rounded transition-colors"
        >
          Allow
        </button>
        <button
          onClick={() => handle('deny')}
          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 text-xs rounded transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  )
}
