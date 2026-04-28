import { useCallback, useEffect, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  $createParagraphNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND
} from 'lexical'
import { Send, Paperclip, X, FileText, Image as ImageIcon, Square } from 'lucide-react'
import { interruptSession, sendMessage } from '../../ipc/bridge'
import { useMessagesStore } from '../../store/messages'
import { useSessionsStore } from '../../store/sessions'
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

// Centralised submit. Both the Send button and the Enter-key plugin call this
// so we never duplicate the echo / clear-editor logic.
function useSubmit({
  sessionId,
  disabled,
  attachments,
  clearAttachments
}: {
  sessionId: string
  disabled: boolean
  attachments: PendingAttachment[]
  clearAttachments: () => void
}): () => boolean {
  const [editor] = useLexicalComposerContext()
  const { appendEvent } = useMessagesStore()

  return useCallback(() => {
    let didSend = false
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
      }
      echoBlocks.push({ type: 'tool_result', tool_use_id: '__input__', content: '' })

      appendEvent(sessionId, {
        type: 'user',
        message: { role: 'user', content: echoBlocks }
      })

      root.clear()
      const fresh = $createParagraphNode()
      root.append(fresh)
      // Place the selection inside the empty paragraph; without this the
      // next keystroke can land outside any node and Lexical inserts a new
      // paragraph, leaving a stray empty line below the typed character.
      fresh.select()
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      clearAttachments()
      didSend = true
    })
    return didSend
  }, [editor, sessionId, disabled, attachments, clearAttachments, appendEvent])
}

function ComposerInner({
  sessionId,
  disabled,
  attachments,
  clearAttachments,
  onPaste
}: {
  sessionId: string
  disabled?: boolean
  attachments: PendingAttachment[]
  clearAttachments: () => void
  onPaste: (e: React.ClipboardEvent) => void
}) {
  const submit = useSubmit({ sessionId, disabled: !!disabled, attachments, clearAttachments })
  return (
    <>
      <div className="flex-1 relative" onPaste={onPaste}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="outline-none min-h-[1.5rem] max-h-40 overflow-y-auto text-sm text-fg leading-relaxed"
            />
          }
          placeholder={
            <div className="absolute top-0 left-0 text-fg-faint text-sm pointer-events-none">
              {disabled ? 'Waiting for session…' : 'Message claude…'}
            </div>
          }
          ErrorBoundary={() => null}
        />
        <OnChangePlugin onChange={() => {}} />
        {/* Records edit history and binds Ctrl/Cmd+Z (undo) and Ctrl/Cmd+
            Shift+Z (redo). The CLEAR_HISTORY_COMMAND that submit dispatches
            after every send was already in place — it's HistoryPlugin's API
            for resetting the undo stack so a sent message isn't recoverable
            via Ctrl+Z. Without this plugin mounted, that dispatch was a
            no-op and Ctrl+Z did nothing. */}
        <HistoryPlugin />
        <SubmitOnEnterPlugin submit={submit} />
        <FocusOnSessionChangePlugin sessionId={sessionId} />
      </div>
      <StopButton sessionId={sessionId} />
      <SendButton disabled={!!disabled} submit={submit} />
    </>
  )
}

// Send is always enabled — claude CLI accepts and queues new messages while
// a turn is in flight, matching the Claude Code interactive behaviour.
function SendButton({
  disabled,
  submit
}: {
  disabled: boolean
  submit: () => boolean
}) {
  return (
    <button
      type="button"
      onClick={() => submit()}
      disabled={disabled}
      title="Send"
      className="p-2 text-fg-faint hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <Send size={16} />
    </button>
  )
}

// Visible only while the active session is busy — clicking sends a
// stream-json control_request/interrupt over stdin so claude aborts the
// in-flight turn without us tearing down the wsl.exe / ssh / claude child
// (which would close the whole chat).
function StopButton({ sessionId }: { sessionId: string }) {
  const isBusy = useSessionsStore(s => s.sessions[sessionId]?.status === 'busy')
  if (!isBusy) return null
  return (
    <button
      type="button"
      onClick={() => interruptSession(sessionId)}
      title="Stop"
      className="p-2 text-red-400/80 hover:text-red-300 transition-colors"
    >
      <Square size={14} fill="currentColor" />
    </button>
  )
}

// Move focus into the editor whenever *this* tab becomes the active one.
// All tabs are mounted at once (App.tsx renders ChatPanel for every tab in
// tabOrder, hiding inactive ones with display:none), so the InputBar's
// `sessionId` prop never changes once mounted — watching only that misses
// every tab-switch via TabBar / sidebar clicks. Subscribing to
// `activeSessionId === sessionId` flips false→true exactly when this tab
// gains focus, which is what we want.
//
// Modals (Settings, Add-Project, Usage) cover the chat with a full-screen
// backdrop, so the user can't switch tabs while one is open — meaning
// this won't yank focus out of an open modal field in practice.
function FocusOnSessionChangePlugin({ sessionId }: { sessionId: string }): null {
  const [editor] = useLexicalComposerContext()
  const isActive = useSessionsStore(s => s.activeSessionId === sessionId)
  useEffect(() => {
    if (!isActive) return
    // Defer one frame so the parent's display:hidden → h-full className flip
    // has actually painted before we focus. Lexical's editor.focus() on a
    // still-display:none element silently no-ops in some browsers.
    const id = requestAnimationFrame(() => editor.focus())
    return () => cancelAnimationFrame(id)
  }, [editor, isActive])
  return null
}

// Lexical command listener — runs before the browser inserts a newline into
// contenteditable. Shift+Enter still reaches PlainTextPlugin's default
// handler so the user can break lines manually.
function SubmitOnEnterPlugin({ submit }: { submit: () => boolean }): null {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const e = event as KeyboardEvent | null
        if (e?.shiftKey) return false
        e?.preventDefault()
        submit()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor, submit])
  return null
}

export function InputBar({ sessionId, disabled = false }: Props) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: FileList | File[]) => {
    // Each fileToAttachment runs a FileReader round-trip — sequential await
    // makes a 5-image paste a 5×readtime stall. Reads are independent and
    // cheap to fan out.
    const results = await Promise.all(
      Array.from(files).map(file => fileToAttachment(file))
    )
    const additions = results.filter((a): a is PendingAttachment => a !== null)
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
      root: 'outline-none min-h-[1.5rem] max-h-40 overflow-y-auto text-sm text-fg leading-relaxed'
    }
  }

  return (
    <div
      className={`border-t border-divider ${dragActive ? 'bg-elevated' : ''}`}
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
          className="p-2 text-fg-faint hover:text-fg transition-colors"
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
          <ComposerInner
            sessionId={sessionId}
            disabled={disabled}
            attachments={attachments}
            clearAttachments={clearAttachments}
            onPaste={handlePaste}
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
}) {
  const isImage = att.kind === 'image'
  return (
    <div className="flex items-center gap-1.5 bg-elevated border border-divider rounded px-2 py-1 text-xs text-fg-muted">
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
        className="text-fg-faint hover:text-fg"
        title="Remove"
      >
        <X size={12} />
      </button>
    </div>
  )
}

async function fileToAttachment(file: File): Promise<PendingAttachment | null> {
  const id = crypto.randomUUID()
  // Pasted images often arrive with empty file.name and a generic .type — sniff
  // the magic bytes so we still classify them as image/png|jpeg|gif|webp.
  const sniffed = await sniffMime(file)
  const mediaType = sniffed ?? file.type ?? 'application/octet-stream'
  const name = file.name || untitledForType(mediaType)

  if (mediaType.startsWith('image/')) {
    const data = await fileToBase64(file)
    return { id, kind: 'image', name, mediaType, data }
  }
  if (mediaType === 'application/pdf') {
    const data = await fileToBase64(file)
    return { id, kind: 'document', name, mediaType, data }
  }
  if (file.size > MAX_INLINE_TEXT_BYTES) {
    console.warn(`Skipping ${name}: ${file.size} bytes exceeds inline text limit`)
    return null
  }
  const text = await file.text()
  return { id, kind: 'text', name, mediaType, text }
}

// FileReader.readAsDataURL is reliable across all binary sizes — manual chunked
// String.fromCharCode + btoa truncates silently for some inputs.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onload = () => {
      const url = String(reader.result ?? '')
      const comma = url.indexOf(',')
      resolve(comma >= 0 ? url.slice(comma + 1) : '')
    }
    reader.readAsDataURL(file)
  })
}

async function sniffMime(file: File): Promise<string | null> {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif'
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp'
  if (head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf'
  return null
}

function untitledForType(mime: string): string {
  if (mime.startsWith('image/')) {
    const ext = mime.split('/')[1] || 'png'
    return `pasted.${ext === 'jpeg' ? 'jpg' : ext}`
  }
  return 'attachment'
}
