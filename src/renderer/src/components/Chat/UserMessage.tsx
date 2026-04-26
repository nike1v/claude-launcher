import { CopyButton } from './CopyButton'
import { AttachmentImage } from './AttachmentImage'
import type { DocumentBlock, ImageBlock } from '../../../../shared/types'
import { FileText, Download } from 'lucide-react'
import { saveFileAs } from '../../ipc/bridge'

interface Props {
  text: string
  attachments?: ReadonlyArray<ImageBlock | DocumentBlock>
}

export function UserMessage({ text, attachments }: Props): JSX.Element {
  const hasAttachments = attachments && attachments.length > 0

  return (
    <div className="group flex justify-end items-start gap-1">
      {text.trim() && (
        <CopyButton text={text} className="opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
      )}
      <div className="max-w-xl flex flex-col items-end gap-2">
        {text.trim() && (
          <div className="bg-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 whitespace-pre-wrap">
            {text}
          </div>
        )}
        {hasAttachments && (
          <div className="flex flex-col gap-1 items-end">
            {attachments!.map((att, i) => {
              if (att.type === 'image') {
                return (
                  <AttachmentImage
                    key={i}
                    mediaType={att.source.media_type}
                    data={att.source.data}
                  />
                )
              }
              return <DocumentChip key={i} block={att} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentChip({ block }: { block: DocumentBlock }): JSX.Element {
  const handleSave = async () => {
    await saveFileAs('document.pdf', block.source.media_type, block.source.data)
  }
  return (
    <div className="group/doc flex items-center gap-2 bg-white/[0.06] rounded px-3 py-2 text-xs text-white/70">
      <FileText size={14} />
      <span>document ({block.source.media_type})</span>
      <button
        type="button"
        onClick={handleSave}
        className="text-white/40 hover:text-white opacity-0 group-hover/doc:opacity-100 transition-opacity"
        title="Save as…"
      >
        <Download size={12} />
      </button>
    </div>
  )
}
