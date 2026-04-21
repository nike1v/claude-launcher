import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HistoryEntry, HostType } from '../shared/types'

const execFileAsync = promisify(execFile)

export class HistoryReader {
  public async loadHistory(host: HostType, projectPath: string): Promise<HistoryEntry[]> {
    const historyDir = pathToClaudeProjectDir(projectPath)
    const command = buildListCommand(host, historyDir)

    let output: string
    try {
      const { stdout } = await execFileAsync(command.bin, command.args, { timeout: 5000 })
      output = stdout
    } catch {
      return []
    }

    return parseHistoryOutput(output)
  }
}

function pathToClaudeProjectDir(absolutePath: string): string {
  // Claude stores project sessions at ~/.claude/projects/<path-with-slashes-as-dashes>/
  // e.g. /home/user/myproject → ~/.claude/projects/-home-user-myproject
  const slug = absolutePath.split('/').join('-')
  return `~/.claude/projects/${slug}`
}

function buildListCommand(
  host: HostType,
  historyDir: string
): { bin: string; args: string[] } {
  // List JSONL files sorted by modification time (newest first), read first line of each
  const shellScript = [
    `if [ -d '${historyDir}' ]; then`,
    `  ls -t '${historyDir}'/*.jsonl 2>/dev/null | head -20 | while read f; do`,
    `    echo "FILE:$f"`,
    `    head -1 "$f" 2>/dev/null`,
    `  done`,
    `fi`
  ].join('\n')

  if (host.kind === 'wsl') {
    return {
      bin: 'wsl.exe',
      args: ['-d', host.distro, '--', 'bash', '-c', shellScript]
    }
  }

  const sshArgs = ['-T']
  if (host.port) sshArgs.push('-p', String(host.port))
  if (host.keyFile) sshArgs.push('-i', host.keyFile)
  sshArgs.push(`${host.user}@${host.host}`, shellScript)

  return { bin: 'ssh', args: sshArgs }
}

function parseHistoryOutput(output: string): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const lines = output.split('\n')
  let currentFile: string | null = null

  for (const line of lines) {
    if (line.startsWith('FILE:')) {
      currentFile = line.slice(5).trim()
      continue
    }
    if (currentFile && line.trim()) {
      const entry = parseJSONLFirstLine(currentFile, line.trim())
      if (entry) entries.push(entry)
      currentFile = null
    }
  }

  return entries
}

function parseJSONLFirstLine(filePath: string, firstLine: string): HistoryEntry | null {
  try {
    const data = JSON.parse(firstLine) as Record<string, unknown>
    // Extract session ID from file path: ~/.claude/projects/slug/<sessionId>.jsonl
    const sessionId = filePath.split('/').pop()?.replace('.jsonl', '') ?? filePath
    const createdAt = typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString()
    const summary = extractSummary(data)
    return { sessionId, createdAt, summary }
  } catch {
    return null
  }
}

function extractSummary(data: Record<string, unknown>): string | undefined {
  // First line of a session JSONL may be a user message — use it as summary
  if (typeof data.content === 'string') return data.content.slice(0, 80)
  if (Array.isArray(data.content)) {
    const first = data.content[0] as Record<string, unknown> | undefined
    if (first && typeof first.text === 'string') return first.text.slice(0, 80)
  }
  return undefined
}
