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
        // The button sits on top of an arbitrary image — it needs constant
        // dark contrast against unknown media, not against our app surface.
        // bg-overlay (theme-stable near-black scrim) + text-overlay-fg
        // (theme-stable near-white) keeps the icon legible whether the
        // image behind it is bright sky or a dark code shot.
        className="absolute top-1 right-1 p-1 rounded bg-overlay text-overlay-fg hover:opacity-90 opacity-0 group-hover:opacity-100 transition-opacity"
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
