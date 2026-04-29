import { useEffect, type ReactNode } from 'react'

interface Props {
  onClose: () => void
  children: ReactNode
  // Tailwind classes for the inner panel — every modal has its own size.
  panelClassName?: string
}

// Shared modal shell: backdrop click and Esc both close. Children are the
// modal panel contents — Modal renders the dimmed overlay and centers the
// panel; the panel's own chrome (border, padding, etc.) stays in the caller.
export function Modal({ onClose, children, panelClassName = '' }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close when the click started AND ended on the backdrop — guards
    // against an accidental close when the user drags a text selection out
    // of an input.
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      onMouseDown={handleBackdrop}
      className="fixed inset-0 bg-overlay flex items-center justify-center z-50"
    >
      <div className={panelClassName}>
        {children}
      </div>
    </div>
  )
}
