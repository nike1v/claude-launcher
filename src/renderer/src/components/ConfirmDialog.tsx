import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface Props {
  // Title shown bold at the top of the dialog. Keep it short — context
  // belongs in `body` rather than the title.
  title: string
  // Optional explanatory copy under the title. Pass a string for plain
  // text or JSX for richer warnings (e.g. an emphasised path).
  body?: ReactNode
  // Default "Confirm" reads as neutral; pass `tone="danger"` for
  // destructive actions so the button colours flag the click as risky.
  tone?: 'neutral' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

// In-app confirmation dialog. Replaces window.confirm where the action
// is destructive enough that we want a modal (not the OS dialog) and
// theming that tracks the rest of the chrome. Reuses the existing
// Modal component for backdrop / Esc handling, so the keyboard story
// (Esc cancels) is consistent with the other modals.
export function ConfirmDialog({
  title,
  body,
  tone = 'neutral',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel
}: Props) {
  const confirmCls = tone === 'danger'
    ? 'bg-danger/12 hover:bg-danger/20 border border-danger/32 text-danger'
    : 'bg-accent/12 hover:bg-accent/20 border border-accent/40 text-fg'
  return (
    <Modal onClose={onCancel} panelClassName="bg-panel border border-divider rounded-lg p-5 w-96">
      <>
        <h2 className="text-sm font-semibold mb-2">{title}</h2>
        {body && <div className="text-xs text-fg-muted mb-4 whitespace-pre-wrap">{body}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-divider text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </>
    </Modal>
  )
}
