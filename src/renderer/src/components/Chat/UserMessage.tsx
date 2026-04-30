import { CopyButton } from './CopyButton'
import { AttachmentImage } from './AttachmentImage'
import type { UserAttachment } from '../../../../shared/events'
import { FileText, Download } from 'lucide-react'
import { saveFileAs } from '../../ipc/bridge'

interface Props {
  text: string
  attachments?: ReadonlyArray<UserAttachment>
}

export function UserMessage({ text, attachments }: Props) {
  const hasAttachments = attachments && attachments.length > 0

  return (
    <div className="group flex justify-end items-start gap-1">
      {text.trim() && (
        <CopyButton text={text} className="opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
      )}
      <div className="max-w-xl flex flex-col items-end gap-2">
        {text.trim() && (
          // bg-bubble-user is an accent-tinted token (indigo-grey on dark,
          // pale blue on light) so user messages read distinctly from
          // assistant turns instead of "two greys talking to each other".
          <div className="bg-bubble-user/40 border border-divider rounded-lg px-3 py-2 text-sm text-fg whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
          </div>
        )}
        {hasAttachments && (
          <div className="flex flex-col gap-1 items-end">
            {attachments!.map((att, i) => {
              if (att.kind === 'image') {
                return (
                  <AttachmentImage
                    key={i}
                    mediaType={att.mediaType}
                    data={att.data}
                  />
                )
              }
              return <DocumentChip key={i} attachment={att} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentChip({ attachment }: { attachment: Extract<UserAttachment, { kind: 'document' }> }) {
  const handleSave = async () => {
    await saveFileAs(attachment.name || 'document.pdf', attachment.mediaType, attachment.data)
  }
  return (
    <div className="group/doc flex items-center gap-2 bg-elevated rounded px-3 py-2 text-xs text-fg-muted">
      <FileText size={14} />
      <span>{attachment.name || `document (${attachment.mediaType})`}</span>
      <button
        type="button"
        onClick={handleSave}
        className="text-fg-faint hover:text-fg opacity-0 group-hover/doc:opacity-100 transition-opacity"
        title="Save as…"
      >
        <Download size={12} />
      </button>
    </div>
  )
}
