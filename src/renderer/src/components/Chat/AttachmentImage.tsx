import { Download } from 'lucide-react'
import { saveFileAs } from '../../ipc/bridge'

interface Props {
  mediaType: string
  data: string // base64
  name?: string
}

export function AttachmentImage({ mediaType, data, name }: Props) {
  const dataUrl = `data:${mediaType};base64,${data}`
  const defaultName = name ?? `image.${extensionFromMime(mediaType)}`

  const handleSave = async () => {
    await saveFileAs(defaultName, mediaType, data)
  }

  return (
    <div className="group relative inline-block">
      <img
        src={dataUrl}
        alt={defaultName}
        className="max-w-xs max-h-64 rounded border border-divider object-contain"
      />
      <button
        type="button"
        onClick={handleSave}
        title={`Save ${defaultName}`}
        className="absolute top-1 right-1 p-1 rounded bg-black/60 text-fg-muted hover:text-fg hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Download size={14} />
      </button>
    </div>
  )
}

function extensionFromMime(mime: string): string {
  const part = mime.split('/')[1]?.toLowerCase() ?? 'bin'
  if (part === 'jpeg') return 'jpg'
  return part
}
