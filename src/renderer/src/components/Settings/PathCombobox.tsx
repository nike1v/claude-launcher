import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import type { HostType } from '../../../../shared/types'
import { listDir } from '../../ipc/bridge'

interface Props {
  value: string
  onChange: (value: string) => void
  config: HostType | null
  placeholder?: string
}

// Combobox for filesystem paths over a transport. The user types freely;
// we list the directory portion (prefix up to the last separator) and
// suggest immediate subdirectories that match the trailing fragment.
// Suggestions are debounced to keep WSL/SSH listings cheap.
export function PathCombobox({ value, onChange, config, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  // Absolute path the backend actually listed for the current `dir`. Used by
  // handlePick so that picking from an empty/`~`/relative input still
  // produces an absolute value (otherwise the next listing resolves against
  // the Electron process cwd and shows the wrong tree).
  const [listedCwd, setListedCwd] = useState<string | null>(null)
  // Tracks the dir the most recently *applied* listing was for. Without
  // this, a slow listing for an old `dir` could land after the user has
  // already typed past it — leaving the dropdown showing stale entries
  // ("the same 2 folders no matter what I type").
  const lastAppliedDirRef = useRef<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const sep = useMemo(() => detectSeparator(config, value), [config, value])
  const { dir, fragment } = useMemo(() => splitPath(value, sep), [value, sep])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDocMouseDown)
    return () => window.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  useEffect(() => {
    if (!config || !open) return
    let cancelled = false
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const result = await listDir(config, dir)
        if (cancelled) return
        const fLower = fragment.toLowerCase()
        // Dedupe defensively — a misbehaving remote shell (banner lines,
        // duplicated find output, symlinks resolving to the same name)
        // would otherwise render twin <li>s with the same React key.
        const seen = new Set<string>()
        const unique: string[] = []
        for (const name of result.entries) {
          if (seen.has(name)) continue
          seen.add(name)
          unique.push(name)
        }
        const filtered = fLower
          ? unique.filter(e => e.toLowerCase().startsWith(fLower))
          : unique
        lastAppliedDirRef.current = dir
        setListedCwd(result.cwd ?? null)
        setSuggestions(filtered.slice(0, 50))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [config, dir, fragment, open])

  const handlePick = (name: string) => {
    // Prefer the absolute cwd the backend resolved for `dir` so picks
    // always produce a navigable absolute path. Falls back to `dir` only
    // if we somehow don't have a cwd yet (first paint, race).
    const useResolved = listedCwd && lastAppliedDirRef.current === dir
    const base = useResolved
      ? (listedCwd!.endsWith(sep) ? listedCwd! : `${listedCwd!}${sep}`)
      : dir
    const joined = base.endsWith(sep) || base === '' ? `${base}${name}` : `${base}${sep}${name}`
    // Append separator so the user can keep diving without typing it.
    onChange(`${joined}${sep}`)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        className="w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
      />
      {open && config && (suggestions.length > 0 || loading) && (
        <ul className="absolute left-0 right-0 mt-1 bg-panel border border-divider rounded shadow-lg z-10 max-h-56 overflow-y-auto">
          {loading && suggestions.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-fg-faint italic">Loading…</li>
          )}
          {suggestions.map(name => (
            <li key={name}>
              <button
                type="button"
                onClick={() => handlePick(name)}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-elevated flex items-center gap-1.5 text-fg"
              >
                <Folder size={12} className="text-fg-faint" />
                <span className="truncate">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function detectSeparator(config: HostType | null, value: string): string {
  // Local on Windows uses backslash; everything else is POSIX. Honour an
  // existing separator in the value first so a user explicitly typing one
  // style sticks with it.
  if (value.includes('/')) return '/'
  if (value.includes('\\')) return '\\'
  if (config?.kind === 'local' && window.electronAPI.platform === 'win32') return '\\'
  return '/'
}

function splitPath(input: string, sep: string): { dir: string; fragment: string } {
  if (!input) return { dir: '', fragment: '' }
  const idx = input.lastIndexOf(sep)
  if (idx < 0) return { dir: '', fragment: input }
  return { dir: input.slice(0, idx + 1), fragment: input.slice(idx + 1) }
}
