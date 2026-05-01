import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderKind } from '../../../../shared/events'
import { MODELS_BY_PROVIDER } from '../../lib/provider-options'

interface Props {
  value: string
  onChange: (value: string) => void
  // Drives the suggestion list — codex/cursor/opencode have very
  // different model id shapes than claude. Defaults to claude for
  // backward compatibility with any caller that hasn't been updated.
  providerKind?: ProviderKind
  placeholder?: string
  className?: string
}

export function ModelCombobox({
  value,
  onChange,
  providerKind = 'claude',
  placeholder,
  className = ''
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const known = MODELS_BY_PROVIDER[providerKind]
    const q = value.trim().toLowerCase()
    if (!q) return known
    return known.filter(m =>
      m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
    )
  }, [value, providerKind])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDocMouseDown)
    return () => window.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        className="w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 bg-panel border border-divider rounded shadow-lg z-10 max-h-56 overflow-y-auto">
          {matches.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => { onChange(m.id); setOpen(false) }}
                className={`w-full text-left px-2 py-1.5 text-xs hover:bg-elevated ${
                  value === m.id ? 'text-fg bg-elevated' : 'text-fg-muted'
                }`}
              >
                <div className="font-mono">{m.id}</div>
                <div className="text-fg-faint">{m.label}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
