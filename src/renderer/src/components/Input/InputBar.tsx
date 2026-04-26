import { useCallback, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, CLEAR_HISTORY_COMMAND, $createParagraphNode } from 'lexical'
import { Send, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react'
import { sendMessage } from '../../ipc/bridge'
import { useMessagesStore } from '../../store/messages'
import type {
  DocumentBlock,
  ImageBlock,
  SendAttachment,
  UserContentBlock
} from '../../../../shared/types'

interface Props {
  sessionId: string
  disabled?: boolean
}

interface PendingAttachment {
  id: string
  kind: 'image' | 'document' | 'text'
  name: string
  mediaType: string
  data?: string // base64 — for image/document
  text?: string // for text
}

const MAX_INLINE_TEXT_BYTES = 256 * 1024 // 256 KB — anything larger gets a warning

function SendButton({
  sessionId,
  disabled,
  attachments,
  clearAttachments
}: Props & {
  attachments: PendingAttachment[]
  clearAttachments: () => void
}): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const { appendEvent } = useMessagesStore()

  const handleSend = useCallback(() => {
    editor.update(() => {
      const root = $getRoot()
      const text = root.getTextContent().trim()
      if (disabled) return
      if (!text && attachments.length === 0) return

      const sendAtts: SendAttachment[] = attachments.map(a => {
        if (a.kind === 'text') return { kind: 'text', name: a.name, text: a.text ?? '' }
        return { kind: a.kind, name: a.name, mediaType: a.mediaType, data: a.data ?? '' }
      })
      sendMessage(sessionId, text, sendAtts.length ? sendAtts : undefined)

      // Local echo. Mirror what the SDK will produce so MessageList renders it
      // the same way as a restored history entry, plus an __input__ marker so
      // the dedup filter can drop the SDK's stdout echo.
      const echoBlocks: UserContentBlock[] = []
      if (text) echoBlocks.push({ type: 'text', text })
      for (const a of attachments) {
        if (a.kind === 'image') {
          echoBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: a.data ?? '' }
          } satisfies ImageBlock)
        } else if (a.kind === 'document') {
          echoBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: a.mediaType, data: a.data ?? '' }
          } satisfies DocumentBlock)
        }
        // Text attachments are folded into the prompt text by the main process,
        // so don't show them as separate chips in the bubble.
      }
      echoBlocks.push({ type: 'tool_result', tool_use_id: '__input__', content: '' })

      appendEvent(sessionId, {
        type: 'user',
        message: { role: 'user', content: echoBlocks }
      })

      root.clear()
      root.append($createParagraphNode())
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      clearAttachments()
    })
  }, [editor, sessionId, disabled, attachments, clearAttachments, appendEvent])

  return (
    <button
      id={`send-btn-${sessionId}`}
      onClick={handleSend}
      disabled={disabled}
      className="p-2 text-white/40 hover:text-white/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <Send size={16} />
    </button>
  )
}

export function InputBar({ sessionId, disabled = false }: Props): JSX.Element {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    const additions: PendingAttachment[] = []
    for (const file of fileArr) {
      const att = await fileToAttachment(file)
      if (att) additions.push(att)
    }
    if (additions.length) setAttachments(prev => [...prev, ...additions])
  }, [])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length) {
      e.preventDefault()
      await addFiles(files)
    }
  }, [addFiles])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer?.files?.length) {
      await addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  const removeAttachment = (id: string) =>
    setAttachments(prev => prev.filter(a => a.id !== id))

  const clearAttachments = useCallback(() => setAttachments([]), [])

  const initialConfig = {
    namespace: `chat-input-${sessionId}`,
    onError: (err: Error) => console.error(err),
    theme: {
      root: 'outline-none min-h-[1.5rem] max-h-40 overflow-y-auto text-sm text-white/90 leading-relaxed'
    }
  }

  return (
    <div
      className={`border-t border-white/10 ${dragActive ? 'bg-white/[0.04]' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={(e) => {
        // Only un-highlight when leaving the bar, not its children.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragActive(false)
      }}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-1.5">
          {attachments.map(a => (
            <AttachmentChip key={a.id} att={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}
      <div className="px-3 py-2 flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-white/40 hover:text-white/80 transition-colors"
          title="Attach files"
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(e.target.files)
              e.target.value = ''
            }
          }}
        />
        <LexicalComposer initialConfig={initialConfig}>
          <div className="flex-1 relative" onPaste={handlePaste}>
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  className="outline-none min-h-[1.5rem] max-h-40 overflow-y-auto text-sm text-white/90 leading-relaxed"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      document.getElementById(`send-btn-${sessionId}`)?.click()
                    }
                  }}
                />
              }
              placeholder={
                <div className="absolute top-0 left-0 text-white/30 text-sm pointer-events-none">
                  {disabled ? 'Waiting for session…' : 'Message claude…'}
                </div>
              }
              ErrorBoundary={() => null}
            />
            <OnChangePlugin onChange={() => {}} />
          </div>
          <SendButton
            sessionId={sessionId}
            disabled={disabled}
            attachments={attachments}
            clearAttachments={clearAttachments}
          />
        </LexicalComposer>
      </div>
    </div>
  )
}

function AttachmentChip({
  att,
  onRemove
}: {
  att: PendingAttachment
  onRemove: () => void
}): JSX.Element {
  const isImage = att.kind === 'image'
  return (
    <div className="flex items-center gap-1.5 bg-white/[0.06] border border-white/10 rounded px-2 py-1 text-xs text-white/70">
      {isImage && att.data ? (
        <img
          src={`data:${att.mediaType};base64,${att.data}`}
          alt={att.name}
          className="w-6 h-6 object-cover rounded"
        />
      ) : att.kind === 'text' ? (
        <FileText size={12} />
      ) : (
        <ImageIcon size={12} />
      )}
      <span className="max-w-[12rem] truncate">{att.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-white/40 hover:text-white"
        title="Remove"
      >
        <X size={12} />
      </button>
    </div>
  )
}

async function fileToAttachment(file: File): Promise<PendingAttachment | null> {
  const id = crypto.randomUUID()
  const name = file.name || untitledForType(file.type)
  const mediaType = file.type || 'application/octet-stream'

  if (mediaType.startsWith('image/')) {
    const data = await fileToBase64(file)
    return { id, kind: 'image', name, mediaType, data }
  }
  if (mediaType === 'application/pdf') {
    const data = await fileToBase64(file)
    return { id, kind: 'document', name, mediaType, data }
  }
  // Treat anything else as text. Anthropic doesn't accept arbitrary binary
  // content blocks anyway, so we either inline as text or fall back gracefully.
  if (file.size > MAX_INLINE_TEXT_BYTES) {
    console.warn(`Skipping ${name}: ${file.size} bytes exceeds inline text limit`)
    return null
  }
  const text = await file.text()
  return { id, kind: 'text', name, mediaType, text }
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  // chunked to avoid stack overflow on large arrays
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[])
  }
  return btoa(binary)
}

function untitledForType(mime: string): string {
  if (mime.startsWith('image/')) {
    const ext = mime.split('/')[1] || 'png'
    return `pasted.${ext === 'jpeg' ? 'jpg' : ext}`
  }
  return 'attachment'
}
