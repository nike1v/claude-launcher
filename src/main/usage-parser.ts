// Parser for the screen-scraped output of claude's interactive `/usage` view.
// Input: raw bytes captured from a PTY running claude (still containing ANSI
// escapes). Output: structured data the renderer can render as bars.
//
// We don't try to reproduce claude's full /usage panel — only the parts that
// are stable enough to scrape. If the layout changes upstream, the parser
// returns a partial result; the modal handles that gracefully.

import type { UsageBar, UsageReading } from '../shared/types'

export interface ParsedUsage extends UsageReading {
  rawText: string // included for the modal's "view raw output" debug toggle
}

const LABEL_PATTERNS: { key: string; regex: RegExp }[] = [
  { key: 'session', regex: /Current\s*session/i },
  { key: 'weekly_all', regex: /Current\s*week\s*\(\s*all\s*models?\s*\)/i },
  { key: 'weekly_sonnet', regex: /Current\s*week\s*\(\s*Sonnet(?:\s*only)?\s*\)/i },
  { key: 'weekly_opus', regex: /Current\s*week\s*\(\s*Opus(?:\s*only)?\s*\)/i }
]

export function cleanPtyOutput(raw: string): string {
  // claude uses \x1b[<n>C to advance the cursor — that's how it spaces out
  // text horizontally instead of emitting literal spaces. If we drop those
  // escapes blindly, "Current session" becomes "Currentsession" and our
  // regexes get fragile. Expand them back into spaces (capped so a stray
  // huge value can't blow up memory).
  return raw
    .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Math.min(200, parseInt(n, 10) || 0)))
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
}

export function parseUsage(raw: string): ParsedUsage {
  const text = cleanPtyOutput(raw)
  const bars: UsageBar[] = []

  for (const { key, regex } of LABEL_PATTERNS) {
    const labelMatch = regex.exec(text)
    if (!labelMatch) continue
    const window = text.slice(labelMatch.index, labelMatch.index + 600)
    const pctMatch = /(\d+)\s*%\s*used/i.exec(window)
    if (!pctMatch) continue
    // Reset line shows up right after the percent, e.g. "Resets 4:50am
    // (Europe/Warsaw)" or "Resets Apr 30, 4am (Europe/Warsaw)". Capture
    // until the next double-space gap or newline so we don't pick up the
    // *next* section's label.
    const resetMatch = /Resets?\s+([^\n]+?)(?=\s{2,}|\n|$)/i.exec(window)
    bars.push({
      key: key as UsageBar['key'],
      label: labelMatch[0].replace(/\s+/g, ' ').trim(),
      percent: clampPercent(parseInt(pctMatch[1], 10)),
      resetsAt: resetMatch ? resetMatch[1].trim() : undefined
    })
  }

  const costMatch = /Total\s*cost\s*:\s*\$?\s*([\d.]+)/i.exec(text)
  const apiDurMatch = /Total\s*duration\s*\(API\)\s*:\s*([^\n]+?)(?=\s{2,}|\n|$)/i.exec(text)

  return {
    bars,
    totalCostUsd: costMatch ? costMatch[1] : undefined,
    totalDurationApi: apiDurMatch ? apiDurMatch[1].trim() : undefined,
    rawText: text
  }
}

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}
