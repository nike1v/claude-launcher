import { useEffect, useRef } from 'react'

interface Props {
  commands: string[]
  selectedIndex: number
  onSelect: (command: string) => void
  onHover: (index: number) => void
}

// Floating list rendered above the InputBar when the user types a `/`
// command. The list is whatever `system/init.slash_commands` advertised
// for this session (Claude only — other providers leave it empty), plus
// the launcher-handled `/clear` synthetic. Filtering and selection-index
// management live in InputBar; this component just renders.
export function SlashCommandPopup({ commands, selectedIndex, onSelect, onHover }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted row in view as the user arrows through a long
  // list (e.g. a project with dozens of skills).
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (commands.length === 0) return null

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded border border-divider bg-card shadow-lg z-20"
    >
      {commands.map((cmd, i) => (
        <div
          key={cmd}
          onMouseDown={(e) => {
            // mousedown (not click) so the editor doesn't blur and reset
            // the selection before we apply the choice.
            e.preventDefault()
            onSelect(cmd)
          }}
          onMouseEnter={() => onHover(i)}
          className={`px-3 py-1.5 text-sm cursor-pointer ${
            i === selectedIndex ? 'bg-accent/20 text-fg' : 'text-fg-muted'
          }`}
        >
          /{cmd}
        </div>
      ))}
    </div>
  )
}
