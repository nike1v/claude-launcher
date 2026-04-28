import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

// Seed list of currently shipping Claude Code-compatible model ids. The user
// can also type a free-form value (e.g. a private alias) — the combobox is
// just a hint, not a hard restriction.
const KNOWN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M context)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]

export function ModelCombobox({ value, onChange, placeholder, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return KNOWN_MODELS
    return KNOWN_MODELS.filter(m =>
      m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
    )
  }, [value])

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
        className="w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-divider-strong"
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
