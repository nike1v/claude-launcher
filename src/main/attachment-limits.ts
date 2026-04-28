import type { SendAttachment } from '../shared/types'

// Bounds enforced at the IPC boundary. The renderer also validates these in
// the file picker UX, but a compromised renderer (or a future bug in the
// upload flow) could submit anything — and unbounded base64 in the JSON line
// we write to claude's stdin would either OOM us or trip the per-line cap in
// session-manager and kill the session.
//
// 20 MiB total covers a generous photo + a multi-page PDF. Single-attachment
// caps keep one absurdly-large file from soaking the whole budget.
export const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
export const MAX_BINARY_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024

// 50 MiB cap on the saved-file payload. Anything legitimate (a PDF claude
// generates, a screenshot the user wants to keep) is far below this; the cap
// just prevents a malicious base64 string from forcing a huge Buffer alloc.
export const MAX_SAVE_FILE_BYTES = 50 * 1024 * 1024

// MIME types we forward to claude as image/document blocks. Anthropic's API
// accepts a defined set; we don't allow `application/x-executable` or
// `text/javascript` etc. to ride through unchallenged.
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp'
])
const ALLOWED_DOCUMENT_MIME = new Set([
  'application/pdf'
])

// Approximate decoded-bytes-from-base64 length without actually decoding. We
// use this for budget enforcement so we don't pay the decode cost just to
// reject oversize inputs.
function approxBase64DecodedSize(b64: string): number {
  return Math.floor((b64.length * 3) / 4)
}

export function validateAttachments(attachments: SendAttachment[]): void {
  let total = 0
  for (const att of attachments) {
    if (att.kind === 'image' || att.kind === 'document') {
      const mimeOk = att.kind === 'image'
        ? ALLOWED_IMAGE_MIME.has(att.mediaType)
        : ALLOWED_DOCUMENT_MIME.has(att.mediaType)
      if (!mimeOk) {
        throw new Error(`Attachment mediaType not allowed: ${JSON.stringify(att.mediaType)}`)
      }
      // Refuse any base64 string with characters outside the spec — silently
      // ignored chars during Buffer.from(..., 'base64') would let an attacker
      // inflate the apparent length while keeping decoded size small (or
      // vice versa).
      if (!/^[A-Za-z0-9+/=]*$/.test(att.data)) {
        throw new Error('Attachment data is not valid base64')
      }
      const size = approxBase64DecodedSize(att.data)
      if (size > MAX_BINARY_ATTACHMENT_BYTES) {
        throw new Error(`Attachment exceeds per-file cap (${size} > ${MAX_BINARY_ATTACHMENT_BYTES} bytes)`)
      }
      total += size
    } else if (att.kind === 'text') {
      const size = Buffer.byteLength(att.text, 'utf8')
      if (size > MAX_TEXT_ATTACHMENT_BYTES) {
        throw new Error(`Text attachment exceeds cap (${size} > ${MAX_TEXT_ATTACHMENT_BYTES} bytes)`)
      }
      total += size
    }
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`Total attachment size exceeds cap (${total} > ${MAX_ATTACHMENT_TOTAL_BYTES} bytes)`)
    }
  }
}

// Strip path separators, leading dots, and control characters from a
// renderer-supplied default filename before handing it to dialog.showSaveDialog.
// The dialog user can still pick any path interactively, but we don't want
// `defaultPath` itself to silently navigate up the tree or contain a NUL.
export function sanitizeDefaultName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = name.replace(/[\x00-\x1f\x7f]/g, '').replace(/[\\/]/g, '_')
  // Drop leading dots so `.bashrc` doesn't end up suggesting a hidden file
  // inside the user's home — and `..foo` can't traverse anywhere.
  const trimmed = stripped.replace(/^\.+/, '')
  if (!trimmed) return 'untitled'
  // Cap the length so a pathological 100 KB name doesn't get embedded in the
  // OS dialog title.
  return trimmed.slice(0, 255)
}

export function validateSaveFilePayload(data: string): void {
  if (!/^[A-Za-z0-9+/=]*$/.test(data)) {
    throw new Error('saveFile data is not valid base64')
  }
  const size = approxBase64DecodedSize(data)
  if (size > MAX_SAVE_FILE_BYTES) {
    throw new Error(`saveFile data exceeds cap (${size} > ${MAX_SAVE_FILE_BYTES} bytes)`)
  }
}
