import { useCallback } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, CLEAR_HISTORY_COMMAND, $createParagraphNode } from 'lexical'
import { Send } from 'lucide-react'
import { sendMessage } from '../../ipc/bridge'
import { useMessagesStore } from '../../store/messages'

interface Props {
  sessionId: string
  disabled?: boolean
}

function SendButton({ sessionId, disabled }: Props): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const { appendEvent } = useMessagesStore()

  const handleSend = useCallback(() => {
    editor.update(() => {
      const root = $getRoot()
      const text = root.getTextContent().trim()
      if (!text || disabled) return

      sendMessage(sessionId, text)

      // Render the user's message locally immediately
      appendEvent(sessionId, {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: '__input__', content: text }] }
      })

      // Clear the editor
      root.clear()
      root.append($createParagraphNode())
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
    })
  }, [editor, sessionId, disabled])

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
  const initialConfig = {
    namespace: `chat-input-${sessionId}`,
    onError: (err: Error) => console.error(err),
    theme: {
      root: 'outline-none min-h-[1.5rem] max-h-40 overflow-y-auto text-sm text-white/90 leading-relaxed'
    }
  }

  return (
    <div className="border-t border-white/10 px-3 py-2 flex items-end gap-2">
      <LexicalComposer initialConfig={initialConfig}>
        <div className="flex-1 relative">
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
        <SendButton sessionId={sessionId} disabled={disabled} />
      </LexicalComposer>
    </div>
  )
}
