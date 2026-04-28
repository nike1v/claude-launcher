import { describe, it, expect } from 'vitest'
import {
  validateAttachments,
  validateSaveFilePayload,
  sanitizeDefaultName,
  MAX_BINARY_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  MAX_SAVE_FILE_BYTES
} from '../../src/main/attachment-limits'

const validBase64 = (decodedBytes: number): string => {
  // Base64 inflates by 4/3, so a string of this length decodes to ~decodedBytes.
  const len = Math.ceil((decodedBytes * 4) / 3)
  return 'A'.repeat(len)
}

describe('validateAttachments', () => {
  it('accepts a normal text attachment', () => {
    expect(() =>
      validateAttachments([{ kind: 'text', name: 'notes.md', text: 'hello world' }])
    ).not.toThrow()
  })

  it('accepts a normal image attachment with a known mediaType', () => {
    expect(() =>
      validateAttachments([
        { kind: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'a.png' }
      ])
    ).not.toThrow()
  })

  it('rejects an image with a non-whitelisted mediaType (e.g. text/javascript)', () => {
    expect(() =>
      validateAttachments([
        { kind: 'image', mediaType: 'text/javascript', data: 'aGVsbG8=' }
      ])
    ).toThrow(/mediaType not allowed/)
  })

  it('rejects a document with a non-whitelisted mediaType', () => {
    expect(() =>
      validateAttachments([
        { kind: 'document', mediaType: 'application/x-executable', data: 'aGVsbG8=', name: 'x' }
      ])
    ).toThrow(/mediaType not allowed/)
  })

  it('rejects base64 with characters outside the spec', () => {
    expect(() =>
      validateAttachments([
        { kind: 'image', mediaType: 'image/png', data: 'aGVsbG8=<script>' }
      ])
    ).toThrow(/not valid base64/)
  })

  it('rejects a single binary attachment past the per-file cap', () => {
    expect(() =>
      validateAttachments([
        {
          kind: 'image',
          mediaType: 'image/png',
          data: validBase64(MAX_BINARY_ATTACHMENT_BYTES + 1024)
        }
      ])
    ).toThrow(/per-file cap/)
  })

  it('rejects a text attachment past its cap', () => {
    expect(() =>
      validateAttachments([
        { kind: 'text', name: 't.txt', text: 'a'.repeat(MAX_TEXT_ATTACHMENT_BYTES + 1) }
      ])
    ).toThrow(/Text attachment exceeds cap/)
  })

  it('rejects when total across multiple attachments exceeds the budget', () => {
    // Each attachment is just under the per-file cap; together they exceed
    // the 20 MiB total budget.
    const each = Math.floor(MAX_BINARY_ATTACHMENT_BYTES * 0.9)
    expect(() =>
      validateAttachments([
        { kind: 'image', mediaType: 'image/png', data: validBase64(each) },
        { kind: 'image', mediaType: 'image/jpeg', data: validBase64(each) }
      ])
    ).toThrow(/Total attachment size/)
  })

  it('accepts an empty list', () => {
    expect(() => validateAttachments([])).not.toThrow()
  })
})

describe('validateSaveFilePayload', () => {
  it('accepts a normal base64 string', () => {
    expect(() => validateSaveFilePayload('SGVsbG8gd29ybGQ=')).not.toThrow()
  })

  it('rejects non-base64 characters', () => {
    expect(() => validateSaveFilePayload('not-valid!@#')).toThrow(/not valid base64/)
  })

  it('rejects payloads past the size cap', () => {
    expect(() => validateSaveFilePayload(validBase64(MAX_SAVE_FILE_BYTES + 1024)))
      .toThrow(/exceeds cap/)
  })
})

describe('sanitizeDefaultName', () => {
  it('replaces forward and backward slashes with underscores', () => {
    expect(sanitizeDefaultName('foo/bar/baz.png')).toBe('foo_bar_baz.png')
    expect(sanitizeDefaultName('foo\\bar.png')).toBe('foo_bar.png')
  })

  it('strips leading dots so traversal sequences cannot be smuggled in', () => {
    expect(sanitizeDefaultName('../etc/passwd')).toBe('.._etc_passwd'.replace(/^\.+/, ''))
    // Concretely:
    expect(sanitizeDefaultName('..foo')).toBe('foo')
  })

  it('removes control characters including null bytes', () => {
    expect(sanitizeDefaultName('foo\x00.png')).toBe('foo.png')
    expect(sanitizeDefaultName('a\x01b\x1fc')).toBe('abc')
  })

  it('falls back to "untitled" if everything was stripped', () => {
    expect(sanitizeDefaultName('')).toBe('untitled')
    expect(sanitizeDefaultName('....')).toBe('untitled')
  })

  it('caps an absurdly long name at 255 characters', () => {
    const result = sanitizeDefaultName('a'.repeat(10_000))
    expect(result.length).toBe(255)
  })
})
